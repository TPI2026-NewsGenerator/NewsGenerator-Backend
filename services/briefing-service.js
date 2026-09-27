//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: briefing-service.js
//  Description: The daily briefing of a user: the stories of the last hours closest to their
//               interests, chosen by the AI, read, summarized and counted
//

"use strict"

import {rss} from "../db/rss-links.js";
import {BriefingModel} from "../models/briefing-model.js";
import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {StoryModel} from "../models/story-model.js";
import {FeedbackService} from "./feedback-service.js";
import {DiscoveryService} from "./discovery-service.js";
import {Crawlers} from "./utils/crawlers.js";
import {newUsage, ollamaResume} from "./utils/ollama.js";
import {checkStories, mergeStories, reviewCards, selectStories, WRITTEN_IN} from "./utils/profile-ai.js";
import {corroborationOf} from "./utils/corroboration.js";
import {hedgedBy} from "./utils/hedging.js";
import {languageOf} from "./utils/language.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {hostOf, mediumOf} from "./utils/public-url.js";
import {credibleStory, decodeLinks, isGoogleNewsUrl, isNotNews, pickCandidates} from "./utils/google-news.js";
import {searchesOfUser} from "./ingest-service.js";

// Measured on four profiles and 249 stories judged by hand:
//  - one vector per interest, dense + half the sparse: 88% of relevant cards (one vector for the
//    whole profile: 38%, worse than the keywords of the search page)
//  - the 40 best then chosen by the AI against the whole profile: 95%, and fewer than 10 when fewer fit
// The refusals of the user are left to the AI: as vectors they removed good stories with the bad.
// Then the AI checks what the chosen stories group (see checkStories): the vectors join two media
// writing on one subject without telling the same fact.
const WINDOW_HOURS = 48;
const SPARSE_WEIGHT = 0.5;
const CANDIDATES = 40;              // stories the AI chooses from, told by at least one feed
// and at most this many known only through Google News, GOOGLE_PER_MEDIUM of one medium (see
// pickCandidates): the AI leaves the pages that are no news out
const GOOGLE_CANDIDATES = 10;
const GOOGLE_PER_MEDIUM = 2;
// the closest stories ranked: the ones known only through Google News take many of the first places
const RANKED = 150;
// A story told by a source the reader trusts gets TRUST_BONUS, among the TRUST_POOL closest stories
// only: a trusted source never brings a story far from the profile. On the UEFA profile the scores
// were 0.516 at rank 40 and 0.502 at rank 60: the bonus lifts a story from about 60th to 35th
const TRUST_POOL = 60;
const TRUST_BONUS = 0.02;
const SHOWN_HOURS = 72;             // a story shown in a briefing of the last 3 days is not shown again
const MAX_SEEN_PER_CALL = 50;       // cards marked seen in one call, a briefing has at most 10
const MAX_SHOWN_COMPARED = 40;      // shown cards the AI compares the chosen stories with, the newest
const READ_PER_STORY = 5;           // articles of a story read to count who wrote it themselves
const AI_CONCURRENCY = 5;
const DESCRIPTION_CHARS = 200;
const CHECKED_PER_STORY = 12;       // other articles of a story checked by the AI, one per medium first
const CHECKED_DESCRIPTION_CHARS = 150;
const ABANDONED_MINUTES = 30;
// Articles of Google News whose real address is asked for one briefing: a page of Google each, and
// Google blocked the first one after about 40 requests of the server in an hour. So only for the
// stories no feed lets read, a few each: the others are summarized from their feeds, their media
// of Google News still count in how many tell them
const MAX_DECODED = 10;
const DECODED_PER_STORY = 2;
const FEED_MEDIA_MINUTES = 60;      // the media read through a feed, asked again after this

const running = new Set();          // users whose briefing is being written by this server

// the feeds this user reads: the shared ones of their languages, their own, and the searches of
// Google News of their interests
const feedsOf = async (userId, languages) => [...new Set([
    ...languages.flatMap(language => Object.values(rss[language] ?? {}).flat()),
    ...await FeedModel.userFeedUrls(userId),
    ...await searchesOfUser(userId),
])];

// the media read through a feed of their own, for the stories known only through Google News
let feedMedia = {at: 0, media: new Set()};
const established = async () => {
    if (Date.now() - feedMedia.at > FEED_MEDIA_MINUTES * 60e3) {
        feedMedia = {at: Date.now(), media: new Set(await FeedModel.feedMedia())};
    }
    return feedMedia.media;
};

// A news read through Google News links to a redirect of Google: its site is the publisher Google
// names, and its address the real one once a briefing found it
const fromGoogle = (article) => isGoogleNewsUrl(article.feed_url);
const siteOf = (article) => hostOf(article.source_url ?? article.link) ?? '';
const mediumOfArticle = (article) => mediumOf(siteOf(article));
const addressOf = (article) => article.resolved_link ?? article.link;

const toArticle = (article, trusted = new Set()) => ({
    title: article.title,
    url: addressOf(article),        // a link of Google News not decoded: the browser follows it
    source: siteOf(article),
    publishedAt: article.at?.toISOString?.() ?? null,
    trusted: trusted.has(article.feed_url),         // from a source the reader trusts
});

// the articles of a story to read: one of a source the reader trusts first (the summary is written
// from the first one that can be read), else its best one, then one per other medium, the newest
// first. A medium met through its feed and through Google News is read from its feed: no address
// to ask Google for
const toRead = (story, trusted = new Set()) => {
    const first = story.members.find(article => trusted.has(article.feed_url)) ?? story.best;
    const byMedium = new Map();
    for (const article of [first, story.best, ...[...story.members].sort((a, b) => b.at - a.at)]) {
        const medium = mediumOfArticle(article);
        const kept = byMedium.get(medium);
        if (!kept || (fromGoogle(kept) && !fromGoogle(article))) byMedium.set(medium, article);
    }
    return [...byMedium.values()].slice(0, READ_PER_STORY);
};

// the other articles of a story the AI checks: one per medium first, the newest first, then the others
const toCheck = (story) => {
    const others = [...story.members].filter(article => article !== story.best).sort((a, b) => b.at - a.at);
    const media = new Set([mediumOfArticle(story.best)]);
    const first = [], then = [];
    for (const article of others) {
        const medium = mediumOfArticle(article);
        (media.has(medium) ? then : first).push(article);
        media.add(medium);
    }
    return [...first, ...then].slice(0, CHECKED_PER_STORY);
};

const brief = (article, chars) => ({
    title: article.title,
    description: (article.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, chars),
});

// the chosen stories keep only the articles the AI says tell the news of their best one, and a card
// telling the news of a card above it joins that card with its articles (two calls sent together).
// The cards shown in the last days come first in that list: a story telling the news of one of them
// is not shown again. One news is often several stories (the French and the English articles of the
// verdict of Manchester City), so a story new by its number can be a news already read.
// If the AI fails, the stories are shown as the vectors grouped them: the check must never cost the
// briefing
const keepSameNews = async (stories, shownCards, usage) => {
    // with the start of their summary: on its title alone, the live page of a match took the place of
    // its preview already shown, and an interview given before a match the place of the match
    const shown = shownCards.slice(0, MAX_SHOWN_COMPARED).map((card, i) => ({id: `shown${i}`, lead: {
        title: card.title,
        description: (card.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS),
    }}));
    const asked = stories
        .map(story => ({story, others: toCheck(story)}))
        .filter(({others}) => others.length > 0);
    const [checked, answered] = await Promise.all([
        checkStories(asked.map(({story, others}) => ({
            id: String(story.storyId),
            lead: brief(story.best, DESCRIPTION_CHARS),
            others: others.map(article => brief(article, CHECKED_DESCRIPTION_CHARS)),
        })), usage.checking).catch(err => {
            console.error(`Briefing: the stories were not checked (${err.message})`);
            return new Map();
        }),
        mergeStories(stories.map(story => ({id: String(story.storyId), lead: brief(story.best, DESCRIPTION_CHARS)})), shown, usage.merging)
            .catch(err => {
                console.error(`Briefing: the cards of one news were not joined (${err.message})`);
                return new Map();
            }),
    ]);

    const kept = new Map(asked.map(({story, others}) => [story.storyId,
        checked.has(String(story.storyId)) ? others.filter((_, i) => checked.get(String(story.storyId)).has(i + 1)) : null]));
    const cards = stories.map(story => {
        const same = kept.get(story.storyId);
        return same ? {...story, members: [story.best, ...same]} : {...story};
    });

    const byId = new Map(cards.map(card => [String(card.storyId), card]));
    const merges = answered;
    const already = new Set([...merges].filter(([, into]) => into.startsWith('shown')).map(([id]) => id));
    if (already.size > 0) console.log(`Briefing: ${already.size} chosen stories were already shown as another story`);
    for (const [id, into] of merges) {
        if (already.has(id)) continue;
        const card = byId.get(into);
        const links = new Set(card.members.map(article => article.link));
        card.members = [...card.members, ...byId.get(id).members.filter(article => !links.has(article.link))];
        card.mergedStoryIds = [...(card.mergedStoryIds ?? []), byId.get(id).storyId];
    }
    return cards.filter(card => !merges.has(String(card.storyId)));
};

const write = async (briefingId, userId) => {
    const usage = {choosing: newUsage(), checking: newUsage(), merging: newUsage(), summarizing: newUsage(), reviewing: newUsage()};
    const [profile, interests] = await Promise.all([ProfileModel.get(userId), ProfileModel.interests(userId)]);
    if (!profile || interests.length === 0) throw Object.assign(new Error('Write your profile first.'), {status: 400});

    // the seconds of each step, logged with the tokens: a slow briefing says where its time went
    const seconds = {};
    let current = null, started = Date.now();
    const step = async (name) => {
        if (current) seconds[current] = Math.round((Date.now() - started) / 1000);
        [current, started] = [name, Date.now()];
        if (name) await BriefingModel.step(briefingId, name);
    };

    // 1. the stories of the last hours closest to the interests, not already shown: scored in the
    // database, where the vectors are (see rank_stories in db/add_briefing.sql)
    await step('ranking');
    const since = new Date(Date.now() - WINDOW_HOURS * 3600e3);
    // the sources found for the profile that bring nothing on it any more are removed first; the
    // briefing never waits on it failing
    await DiscoveryService.prune(userId).catch(err => console.error(`Briefing: the sources were not pruned (${err.message})`));
    // the thumbs of the reader: examples for the choice, and the sources found for the profile whose
    // cards were refused again and again are left out
    const feedback = await FeedbackService.of(userId);
    const refused = new Set(feedback.refused);
    const feedUrls = (await feedsOf(userId, profile.languages)).filter(url => !refused.has(url));
    // the sources the reader trusts: their stories get a bonus, among the TRUST_POOL closest only
    const trusted = new Set(await FeedModel.trustedFeedUrls(userId));
    const shownCards = await BriefingModel.shownCards(userId, new Date(Date.now() - SHOWN_HOURS * 3600e3));
    const ranked = await StoryModel.rank({
        userId, feedUrls, since,
        languages: profile.languages,
        sparseWeight: SPARSE_WEIGHT,
        excluded: shownCards.flatMap(card => card.storyIds).filter(Number.isInteger),
        limit: RANKED,
    });
    if (ranked.length === 0) {
        throw new Error('No new story to choose from: the news of the last 48 hours are not read and embedded yet, or they were all shown already. The background work runs every few minutes, try again soon.');
    }

    // the news of those stories the user can read, with the one that scored the best
    const members = new Map(ranked.map(row => [row.id_story, []]));
    for (const article of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) {
        members.get(article.id_story).push(article);
    }
    const media = await established();
    const byId = new Map(ranked.map((row, rank) => {
        const news = members.get(row.id_story);
        // the bonus only among the TRUST_POOL closest: a trusted source never brings a story far
        // from the profile
        const told = rank < TRUST_POOL && news.some(article => trusted.has(article.feed_url));
        return [String(row.id_story), {
            storyId: row.id_story,
            best: news.find(article => article.id === row.id_article) ?? news[0],
            interest: interests.find(interest => interest.id === row.id_interest)?.text ?? null,
            members: news,
            trusted: told,
            score: Number(row.score) + (told ? TRUST_BONUS : 0),
        }];
    }));
    const candidates = pickCandidates([...byId.values()]
        .filter(story => story.best && credibleStory(story.members, media))
        .sort((a, b) => b.score - a.score), {fromFeeds: CANDIDATES, extra: GOOGLE_CANDIDATES, perMedium: GOOGLE_PER_MEDIUM});

    // 2. the AI chooses, against the whole profile and what it refuses
    await step('choosing');
    const selected = await selectStories(profile.text, candidates.map(story => ({
        id: String(story.storyId),
        title: story.best.title,
        description: (story.best.description ?? '').slice(0, DESCRIPTION_CHARS),
        others: story.members.filter(article => article !== story.best).map(article => article.title).slice(0, 3),
        trusted: story.trusted,
    })), usage.choosing, feedback.examples);
    if (selected.length === 0) return [];

    // 3. the AI checks which articles of each story tell the news of its best one
    await step('checking');
    const chosen = await keepSameNews(selected.map(item => ({...byId.get(item.id), why: item.why})), shownCards, usage);

    // 4. the chosen stories read: their texts say who wrote them and give the summary
    await step('reading');
    // the real address of the news of Google News to read, never asked twice (see google-news.js)
    const toDecode = [...new Set(chosen.map(story => toRead(story, trusted))
        .filter(articles => articles.every(article => fromGoogle(article) && !article.resolved_link))
        .flatMap(articles => articles.slice(0, DECODED_PER_STORY).map(article => article.link)))].slice(0, MAX_DECODED);
    if (toDecode.length > 0) {
        const decoded = await decodeLinks(toDecode);
        console.log(`Briefing: ${decoded.size} of ${toDecode.length} addresses of Google News found`);
        for (const article of chosen.flatMap(story => story.members)) {
            if (decoded.has(article.link)) article.resolved_link = decoded.get(article.link);
        }
        await FeedModel.saveResolvedLinks([...decoded].map(([link, resolved]) => ({link, resolved})));
    }
    // a page of Google News its address shows is no news (a live blog, a table) is left out, and the
    // story with it when it had nothing else
    const stories = chosen.flatMap(story => {
        const members = story.members.filter(article => !fromGoogle(article) || !isNotNews(article.title, article.resolved_link));
        if (members.length === 0) return [];
        return [{...story, members, best: members.includes(story.best) ? story.best : members[0]}];
    });
    if (stories.length < chosen.length) console.log(`Briefing: ${chosen.length - stories.length} chosen stories of Google News were no news`);
    const reads = stories.map(story => toRead(story, trusted));
    // a link of Google News not decoded is not read: it only leads to a redirect
    const readable = (article) => !fromGoogle(article) || Boolean(article.resolved_link);
    const pages = await Crawlers.Html([...new Set(reads.flat().filter(readable).map(addressOf))]);
    const byAddress = new Map(pages.map(page => [page.url, page]));
    const content = new Map(stories.flatMap(story => story.members)
        .filter(article => readable(article) && byAddress.has(addressOf(article)))
        .map(article => [article.link, byAddress.get(addressOf(article))]));

    // 5. one summary per story, in the language of the profile
    await step('summarizing');
    const language = WRITTEN_IN[languageOf(profile.text, profile.languages[0])] ?? 'English';
    const summaries = await mapWithConcurrency(stories, AI_CONCURRENCY, async (story, i) => {
        const readable = reads[i].find(article => content.get(article.link)?.content);
        if (!readable) return null;
        return {...await ollamaResume(readable.title, content.get(readable.link).content, {language, usage: usage.summarizing}),
            from: readable.link};
    });
    const summaryOf = (i) => summaries[i].status === 'fulfilled' ? summaries[i].value : null;

    // 6. the cards read once more with their summary, which says what a title may not: the ones on
    // what the reader refuses are left out (see reviewCards). The briefing never waits on it failing
    const leftOut = await reviewCards(profile.text, stories.map((story, i) => ({
        id: String(story.storyId),
        title: (story.members.find(article => article.link === summaryOf(i)?.from) ?? story.best).title,
        summary: summaryOf(i)?.summary ?? null,
    })), usage.reviewing).catch(err => {
        console.error(`Briefing: the cards were not read again (${err.message})`);
        return new Map();
    });
    if (leftOut.size > 0) console.log(`Briefing: ${leftOut.size} cards on what the reader refuses left out (${[...leftOut.values()].join(' / ')})`);
    await step(null);
    console.log(`Briefing ${briefingId}: tokens ${JSON.stringify(usage)}, seconds ${JSON.stringify(seconds)}`);

    return stories.flatMap((story, i) => {
        if (leftOut.has(String(story.storyId))) return [];
        const summary = summaryOf(i);
        const lead = story.members.find(article => article.link === summary?.from) ?? story.best;
        const members = [...story.members].sort((a, b) => b.at - a.at);

        return {
            storyId: story.storyId,
            mergedStoryIds: story.mergedStoryIds ?? [],   // cards of the same news joined to this one
            seenAt: null,                                  // set once it stayed on the screen (markSeen)
            vote: null,                                    // the thumb of the reader, 'up' or 'down'
            // the feeds its articles came from: a refused card is blamed on them (utils/feedback.js),
            // never on a search of Google News, which is the interest itself
            feedUrls: [...new Set(story.members.map(article => article.feed_url).filter(url => url && !isGoogleNewsUrl(url)))],
            title: lead.title,
            why: story.why,
            interest: story.interest,
            summary: summary?.summary ?? null,
            topic: summary?.topic ?? null,
            sourcing: summary?.sourcing ?? null,
            // the words the article itself used to say it has no confirmation
            hedged: hedgedBy(lead.title, lead.description),
            thumbnail: members.find(article => article.thumbnail)?.thumbnail ?? null,
            publishedAt: members[0].at?.toISOString?.() ?? null,
            corroboration: {
                ...corroborationOf(story.members.map(article => ({
                    medium: mediumOfArticle(article),
                    text: content.get(article.link)?.content ?? null,
                    byline: content.get(article.link)?.author ?? '',
                }))),
                mediaNames: [...new Set(members.map(mediumOfArticle))],
            },
            // the ones of a trusted source first: its star was sixth of eleven, behind "show all"
            articles: [...members].sort((a, b) => trusted.has(b.feed_url) - trusted.has(a.feed_url))
                .map(article => toArticle(article, trusted)),
        };
    });
};

const toBriefing = (row) => row && ({
    id: row.id,
    status: row.status,             // running, ready, failed
    step: row.step,                 // ranking, choosing, reading, summarizing
    error: row.error,
    items: row.items ?? [],
    createdAt: row.created_at,
    finishedAt: row.finished_at,
});

export const BriefingService = {
    // the last briefing of this user, running or not
    latest: async (userId) => toBriefing(await BriefingModel.latest(userId)),

    // these cards of a briefing stayed on the screen: only the cards seen are left out of the next
    // briefings, the others can come back while their news is in the window
    markSeen: async (userId, briefingId, storyIds) => {
        const id = Number(briefingId);
        if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Unknown briefing.'), {status: 404});
        if (!Array.isArray(storyIds) || storyIds.length === 0 || storyIds.length > MAX_SEEN_PER_CALL
            || !storyIds.every(storyId => Number.isInteger(storyId) && storyId > 0)) {
            throw Object.assign(new Error(`storyIds: 1 to ${MAX_SEEN_PER_CALL} story ids.`), {status: 400});
        }
        if (await BriefingModel.markSeen(userId, id, [...new Set(storyIds)]) === 0) {
            throw Object.assign(new Error('Unknown briefing.'), {status: 404});
        }
    },

    // the thumb of the reader on a card: 'up' (good for me), 'down' (not for me) or null (taken back).
    // The next briefings read them (see FeedbackService)
    vote: async (userId, briefingId, storyId, vote) => {
        const id = Number(briefingId);
        if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Unknown briefing.'), {status: 404});
        if (!Number.isInteger(storyId) || storyId <= 0) throw Object.assign(new Error('storyId: the story of a card.'), {status: 400});
        if (vote !== 'up' && vote !== 'down' && vote !== null) throw Object.assign(new Error("vote: 'up', 'down' or null."), {status: 400});
        if (await BriefingModel.vote(userId, id, storyId, vote) === 0) {
            throw Object.assign(new Error('Unknown card.'), {status: 404});
        }
    },

    // a new briefing, written in background: the answer is the briefing still running, the client
    // asks for it again until it is ready. Only one at a time per user
    start: async (userId) => {
        await BriefingModel.failAbandoned(new Date(Date.now() - ABANDONED_MINUTES * 60 * 1000));
        if (running.has(userId)) return toBriefing(await BriefingModel.running(userId));

        const briefing = await BriefingModel.create(userId);
        running.add(userId);

        write(briefing.id, userId)
            .then(items => BriefingModel.finish(briefing.id, items))
            .catch(err => {
                console.error(`Briefing ${briefing.id} failed: ${err.stack ?? err}`);
                return BriefingModel.fail(briefing.id, err.message ?? String(err));
            })
            .finally(() => running.delete(userId));

        return toBriefing(briefing);
    },
};
