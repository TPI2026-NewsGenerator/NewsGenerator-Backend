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
import {newUsage} from "./utils/ollama.js";
import {canSummarize, extractArticle, passagesText, translateTexts} from "./utils/extract.js";
import {balanceSelection, checkStories, mergeStories, reviewCards, selectStories} from "./utils/profile-ai.js";
import {corroborationOf} from "./utils/corroboration.js";
import {hedgedBy} from "./utils/hedging.js";
import {readerLanguage, writtenIn} from "./utils/language.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {hostOf, mediumOf} from "./utils/public-url.js";
import {credibleStory, decodeLinks, isGoogleNewsUrl, isNotNews, isRepeatedPage, pickCandidates} from "./utils/google-news.js";
import {searchesOfUser} from "./ingest-service.js";
import {onceEach} from "./utils/reading-order.js";

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
// A story is of one language (db/add_briefing.sql): a card chosen in another language than the reader's
// asks the AI which of the VERSIONS_PER_STORY stories of the reader's language closest to it, from
// VERSION_LIKENESS, tell its news, and those join it. Measured on a briefing of a reader of French with
// 7 cards in 4 other languages (bench/lead-language-close.mjs, bench/versions-replay.mjs): the French
// versions of the Negreira affair, of the UEFA payments and of Ceferin against Infantino were at 0.79
// to 0.91 and the AI joined the 4 asked, other news of UEFA were below 0.71. The search joins the cards of two languages from 0.75 on, the AI confirming: 34 of
// 35 right (bench/cross-language-merge.mjs)
const VERSION_LIKENESS = 0.75;
const VERSIONS_PER_STORY = 2;

const running = new Set();          // users whose briefing is being written by this server

// the feeds this user reads: the shared ones of every language, their own, and the searches of Google
// News of their interests. Every language is read and translated: replayed on a reader of 7 languages
// with sources in 30 (bench/briefing-languages.mjs), the others took 13 of the 42 candidates and 2 of
// the 10 cards, both on the profile (the UEFA president on Infantino in Albanian)
const feedsOf = async (userId) => [...new Set([
    ...Object.values(rss).flatMap(categories => Object.values(categories).flat()),
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
// from the first one that can be read), else its best one when written in the language of the reader,
// else the newest one in that language (one of a feed before one of Google News, whose address must be
// asked), else its best one; then one per other medium, the newest first. The articles in the
// language of the reader come from its versions (see VERSION_LIKENESS): a story is of one language.
// A medium met through its feed and through Google News is read from its feed: no address to ask
// Google for
const toRead = (story, trusted = new Set(), language = null) => {
    const inLanguage = (article) => Boolean(language) && article.lang === language;
    const newest = [...story.members].sort((a, b) => b.at - a.at);
    const first = story.members.find(article => trusted.has(article.feed_url))
        ?? (inLanguage(story.best) ? story.best : null)
        ?? newest.find(article => inLanguage(article) && !fromGoogle(article))
        ?? newest.find(inLanguage)
        ?? story.best;
    const byMedium = new Map();
    for (const article of [first, story.best, ...newest]) {
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
// One news is often several stories (the French and the English articles of the verdict of
// Manchester City). The versions in the language of the reader (see versionsOf) are asked after the
// cards, and join the one whose news they tell: the card is then read in that language. If the AI
// fails, the stories are shown as the vectors grouped them: the check must never cost the briefing
const keepSameNews = async (stories, usage, versions = []) => {
    const asked = stories
        .map(story => ({story, others: toCheck(story)}))
        .filter(({others}) => others.length > 0);
    const [checked, merges] = await Promise.all([
        checkStories(asked.map(({story, others}) => ({
            id: String(story.storyId),
            lead: brief(story.best, DESCRIPTION_CHARS),
            others: others.map(article => brief(article, CHECKED_DESCRIPTION_CHARS)),
        })), usage.checking).catch(err => {
            console.error(`Briefing: the stories were not checked (${err.message})`);
            return new Map();
        }),
        mergeStories([...stories, ...versions].map(story => ({id: String(story.storyId), lead: brief(story.best, DESCRIPTION_CHARS)})), usage.merging)
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

    const byId = new Map([...cards, ...versions].map(card => [String(card.storyId), card]));
    const isCard = new Set(cards.map(card => String(card.storyId)));
    for (const [id, into] of merges) {
        // a version joins a card, never another version
        if (!isCard.has(into)) continue;
        const card = byId.get(into);
        const links = new Set(card.members.map(article => article.link));
        card.members = [...card.members, ...byId.get(id).members.filter(article => !links.has(article.link))];
        card.mergedStoryIds = [...(card.mergedStoryIds ?? []), byId.get(id).storyId];
    }
    const joined = [...merges].filter(([id, into]) => !isCard.has(id) && isCard.has(into)).length;
    if (joined > 0) console.log(`Briefing: ${joined} versions in the language of the reader joined their card`);
    return cards.filter(card => !merges.has(String(card.storyId)));
};

// the stories in the language of the reader closest to the chosen ones written in another, with the
// news of them the reader can read (see VERSION_LIKENESS): [{storyId, best, members}]
const versionsOf = async (stories, {language, feedUrls, since}) => {
    const rows = await StoryModel.versionsIn({
        storyIds: stories.map(story => story.storyId), language, feedUrls, since,
        likeness: VERSION_LIKENESS, perStory: VERSIONS_PER_STORY,
    });
    const chosen = new Set(stories.map(story => story.storyId));
    const ids = [...new Set(rows.map(row => row.id_version))].filter(id => !chosen.has(id));
    if (ids.length === 0) return [];
    const members = new Map(ids.map(id => [id, []]));
    for (const article of await StoryModel.storyArticles({storyIds: ids, feedUrls, since})) {
        members.get(article.id_story).push(article);
    }
    return ids.filter(id => members.get(id).length > 0)
        .map(id => ({storyId: id, best: members.get(id)[0], members: members.get(id)}));
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

    // 1. the stories of the last hours closest to the interests: scored in the
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
    const feedUrls = (await feedsOf(userId)).filter(url => !refused.has(url));
    // the sources the reader trusts: their stories get a bonus, among the TRUST_POOL closest only
    const trusted = new Set(await FeedModel.trustedFeedUrls(userId));
    const ranked = await StoryModel.rank({
        userId, feedUrls, since,
        languages: null,
        sparseWeight: SPARSE_WEIGHT,
        limit: RANKED,
    });
    if (ranked.length === 0) {
        throw new Error('No story to choose from: the news of the last 48 hours are not read and embedded yet. The background work runs every few minutes, try again soon.');
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
            interestId: row.id_interest,
            interest: interests.find(interest => interest.id === row.id_interest)?.text ?? null,
            members: news,
            score: Number(row.score) + (told ? TRUST_BONUS : 0),
        }];
    }));
    const candidates = pickCandidates([...byId.values()]
        .filter(story => story.best && credibleStory(story.members, media) && !isRepeatedPage(story.members))
        .sort((a, b) => b.score - a.score), {fromFeeds: CANDIDATES, extra: GOOGLE_CANDIDATES, perMedium: GOOGLE_PER_MEDIUM});

    // 2. the AI chooses, against the whole profile and what it refuses
    await step('choosing');
    const chosenByAi = await selectStories(profile.text, candidates.map(story => ({
        id: String(story.storyId),
        title: story.best.title,
        description: (story.best.description ?? '').slice(0, DESCRIPTION_CHARS),
        others: story.members.filter(article => article !== story.best).map(article => article.title).slice(0, 3),
    })), usage.choosing, feedback.examples, interests.map(interest => interest.text));
    const selected = balanceSelection(chosenByAi, id => byId.get(id)?.interestId, interests);
    if (selected.length === 0) return [];

    // 3. the AI checks which articles of each story tell the news of its best one, and which versions
    // in the language of the reader tell the news of a card in another
    await step('checking');
    const language = readerLanguage(profile);
    const picked = selected.map(item => ({...byId.get(item.id), why: item.why}));
    const versions = await versionsOf(picked, {language, feedUrls, since})
        .catch(err => {
            console.error(`Briefing: no version in the language of the reader looked for (${err.message})`);
            return [];
        });
    const chosen = await keepSameNews(picked, usage, versions);

    // 4. the chosen stories read: their texts say who wrote them and give the summary
    await step('reading');
    // the real address of the news of Google News to read, never asked twice (see google-news.js): of
    // the stories no feed lets read, and of the article in the language of the reader read first (the
    // French version of a card in Albanian was known in the last hours through Google News only)
    const undecoded = (article) => fromGoogle(article) && !article.resolved_link;
    const toDecode = [...new Set(chosen.map(story => toRead(story, trusted, language))
        .flatMap(articles => articles.every(undecoded) ? articles.slice(0, DECODED_PER_STORY)
            : undecoded(articles[0]) && articles[0].lang === language ? [articles[0]] : [])
        .map(article => article.link))].slice(0, MAX_DECODED);
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
    const reads = stories.map(story => toRead(story, trusted, language));
    // a link of Google News not decoded is not read: it only leads to a redirect
    const readable = (article) => !fromGoogle(article) || Boolean(article.resolved_link);
    const pages = await Crawlers.Html([...new Set(reads.flat().filter(readable).map(addressOf))]);
    const byAddress = new Map(pages.map(page => [page.url, page]));
    const content = new Map(stories.flatMap(story => story.members)
        .filter(article => readable(article) && byAddress.has(addressOf(article)))
        .map(article => [article.link, byAddress.get(addressOf(article))]));

    // 5. the key passages of each story, as published (see extract.js), translated for a reader of
    // another language
    await step('summarizing');
    const summaries = await mapWithConcurrency(stories, AI_CONCURRENCY, async (story, i) => {
        // the first lines of a page (a teaser, a paywall) do not tell the news
        const readable = reads[i].find(article => canSummarize(content.get(article.link)?.content));
        if (!readable) return null;
        const {passages, translation, topic, sourcing} = await extractArticle(readable.title, content.get(readable.link),
            {language, usage: usage.summarizing});
        if (passages.length === 0) return null;
        return {summary: passagesText(passages), translation: passagesText(translation), topic, sourcing, from: readable.link};
    });
    const summaryOf = (i) => summaries[i].status === 'fulfilled' ? summaries[i].value : null;

    // 6. the cards read once more with their summary, which says what a title may not: the ones on
    // what the reader refuses are left out (see reviewCards). The briefing never waits on it failing
    const leadOf = (story, i) => story.members.find(article => article.link === summaryOf(i)?.from) ?? story.best;
    const leads = stories.map(leadOf);
    // and the titles written in another language than the reader's translated, as their passages
    const foreign = leads.filter(lead => lead.lang && lead.lang !== language && writtenIn(lead.lang) && writtenIn(language));
    const [leftOut, titleTranslations] = await Promise.all([
        reviewCards(profile.text, stories.map((story, i) => ({
            id: String(story.storyId),
            title: leads[i].title,
            summary: summaryOf(i)?.summary ?? null,
        })), usage.reviewing).catch(err => {
            console.error(`Briefing: the cards were not read again (${err.message})`);
            return new Map();
        }),
        foreign.length === 0 ? [] : translateTexts(foreign.map(lead => ({text: lead.title, from: writtenIn(lead.lang)})),
            writtenIn(language), usage.summarizing),
    ]);
    const titleTranslation = new Map(foreign.map((lead, i) => [lead, titleTranslations[i]]));
    if (leftOut.size > 0) console.log(`Briefing: ${leftOut.size} cards on what the reader refuses left out (${[...leftOut.values()].join(' / ')})`);
    await step(null);
    console.log(`Briefing ${briefingId}: tokens ${JSON.stringify(usage)}, seconds ${JSON.stringify(seconds)}`);

    return stories.flatMap((story, i) => {
        if (leftOut.has(String(story.storyId))) return [];
        const summary = summaryOf(i);
        const lead = leads[i];
        const members = [...story.members].sort((a, b) => b.at - a.at);

        return {
            storyId: story.storyId,
            mergedStoryIds: story.mergedStoryIds ?? [],   // cards of the same news joined to this one
            vote: null,                                    // the thumb of the reader, 'up' or 'down'
            // the feeds its articles came from: a refused card is blamed on them (utils/feedback.js),
            // never on a search of Google News, which is the interest itself
            feedUrls: [...new Set(story.members.map(article => article.feed_url).filter(url => url && !isGoogleNewsUrl(url)))],
            title: lead.title,
            // the title in the language of the reader when it is written in another, and that language
            titleTranslation: titleTranslation.get(lead) ?? null,
            language: lead.lang ?? null,
            why: story.why,
            interest: story.interest,
            // the key sentences of the article as published, a paragraph per passage (see extract.js)
            summary: summary?.summary ?? null,
            // their machine translation, when the article is not in the language of the reader
            translation: summary?.translation ?? null,
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
            articles: onceEach([...members].sort((a, b) => trusted.has(b.feed_url) - trusted.has(a.feed_url)),
                {medium: mediumOfArticle, fromGoogle})
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
