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
import {languageOf} from "./utils/language.js";
import {BRIEFING_SIZES, MAX_BRIEFING, balanceSelection, checkStories, mergeStories, reviewCards, selectStories, shareOut} from "./utils/profile-ai.js";
import {corroborationOf} from "./utils/corroboration.js";
import {hedgedBy} from "./utils/hedging.js";
import {contestedOf} from "./utils/contested.js";
import {otherAnglesOf, placeAngles, sameFactsOut} from "./utils/other-angles.js";
import {AFFAIR_DAYS, storiesOfSameNames} from "./utils/affair-names.js";
import {officialSourcesOf} from "./utils/official-sources.js";
import {evolvedStories, REPEAT_HOURS, shownStories, withoutRepeats} from "./utils/repeats.js";
import {readerLanguage, writtenIn} from "./utils/language.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {assertPublicUrl, hostOf, mediumOf} from "./utils/public-url.js";
import {credibleStory, decodeLinks, googleAvailable, isGoogleNewsUrl, isNotNews, isRepeatedPage, pickCandidates} from "./utils/google-news.js";
import {searchesOfUser} from "./ingest-service.js";
import {onceEach} from "./utils/reading-order.js";
import {readableCards} from "./utils/readable-cards.js";
import {Filter} from "./utils/filter.js";
import {UserModel} from "../models/user-model.js";
import {EMAIL_RULE, isEmail} from "./utils/account-rules.js";
import {sendMail} from "./utils/mailer.js";
import {briefingMail, MAIL_FORMATS} from "./utils/briefing-mail.js";
import {storyPictures, withChosenPictures} from "./utils/mail-pictures.js";
import {SentMailModel} from "../models/sent-mail-model.js";
import {EntityService} from "./entity-service.js";
import {namesOfCards} from "./utils/card-names.js";

// Measured on four profiles and 249 stories judged by hand:
//  - one vector per interest, dense + half the sparse: 88% of relevant cards (one vector for the
//    whole profile: 38%, worse than the keywords of the search page)
//  - the 40 best then chosen by the AI against the whole profile: 95%, and fewer than 10 when fewer fit
// The refusals of the user are left to the AI: as vectors they removed good stories with the bad.
// Then the AI checks what the chosen stories group (see checkStories): the vectors join two media
// writing on one subject without telling the same fact.
// The hours of news a briefing is written from, chosen by the reader on a bar of 1 to 7 days (the user,
// 14.10.2026; 24 hours, 2 or 7 days before), 2 days by default, the window of every bench. Over 7 days
// the ranking took the same 2 to 3 s and the same 40 candidates go to the AI, so a briefing of the week
// costs no more (bench/briefing-window.mjs). A month is not offered: the articles are kept 30 days, the
// oldest would be leaving as it is written
const WINDOWS = [1, 2, 3, 4, 5, 6, 7].map(days => days * 24);
const DEFAULT_HOURS = 48;
// From this many hours a briefing is one of several days. The 40 closest stories of a week were 34
// affairs of several days (threads, db/add_threads.sql), and guides of no day rose among them: one
// candidate per thread, and the AI is told how many media told each to prefer what mattered (see
// selectionPrompt)
const WEEK_FROM_HOURS = 72;
const SPARSE_WEIGHT = 0.5;
const CANDIDATES = 40;              // stories the AI chooses from, told by at least one feed
// and at most this many known only through Google News, GOOGLE_PER_MEDIUM of one medium (see
// pickCandidates): the AI leaves the pages that are no news out
const GOOGLE_CANDIDATES = 10;
const GOOGLE_PER_MEDIUM = 2;
// the closest stories ranked: the ones known only through Google News take many of the first places.
// Each interest has its share of them by its weight among the RANKED_POOL closest, as of the
// CANDIDATES (see shareOut): ranking 600 takes the same time as 150, the scores are all computed
const RANKED = 150;
const RANKED_POOL = 600;
// A story told by a medium the reader trusts (see FeedModel.trustedMedia), among the TRUST_POOL closest
// stories, is given to the AI besides the CANDIDATES, TRUSTED_CANDIDATES at most: a trusted source never
// brings a story far from the profile, and never takes the place of a closer one. A bonus of the score
// did (bench/trust-thumbs.mjs, the UEFA reader with 4 media trusted): 2 stories of one of them off the
// profile went into the 40, the AI left them out, and the 40th it would have chosen was gone
const TRUST_POOL = 60;
const TRUSTED_CANDIDATES = 10;
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
// The versions of a card in the other languages, checked by the AI with its articles: of the 30 stories
// Enzo's briefing ranked first (bench/versions-across.mjs), the closest from 0.85 on were nearly all
// the same fact told in another language (a candidate against Infantino in Spanish, German, Dutch,
// Serbian and Polish), between 0.75 and 0.85 often another fact of the same affair: the check sorts them
const ACROSS_LIKENESS = 0.78;
const ACROSS_PER_STORY = 4;
// "Other angles" of a card (see other-angles.js): the stories of the last ANGLES_DAYS of any language
// closest to it from ANGLE_LIKENESS, none already on a card, ANGLE_CANDIDATES of them judged by the AI
// (bench/other-angles.mjs: the other facts of an affair were between 0.65 and 0.9, the same field
// below). An affair goes on for days: a card of today gets the step of yesterday
const ANGLES_DAYS = 3;
const ANGLE_LIKENESS = 0.6;
const ANGLE_CANDIDATES = 8;
const ANGLE_QUERIES = 5;            // cards compared at the same time in the database
// and the stories of the last AFFAIR_DAYS naming the rare names of the card (see affair-names.js), the
// other stances of its actors, these many more at most
const NAMED_CANDIDATES = 5;
const CARD_TITLES = 5;              // other titles of a card given with it, one per language first

const running = new Set();          // users whose briefing is being written by this server

// "24 hours", "3 days": said in the messages
const spanOf = (hours) => hours > 24 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`;

// The feeds a profile reads: the shared ones of every language, the sources of every reader (found for
// their profiles or added by hand, of every profile: every source is for everyone since 8.10.2026, those
// that may hold a key aside), and the searches of Google News of its interests. Every language is read
// and translated: replayed on a reader of 7 languages with sources in 30 (bench/briefing-languages.mjs),
// the others took 13 of the 42 candidates and 2 of the 10 cards, both on the profile (the UEFA president
// on Infantino in Albanian)
export const feedsOf = async (profileId) => [...new Set([
    ...Object.values(rss).flatMap(categories => Object.values(categories).flat()),
    ...await FeedModel.userFeedUrls(profileId),
    ...await FeedModel.everyoneFeedUrls(),
    ...await searchesOfUser(profileId),
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
// A story known only through Google News is read at the address Google gives for it. While Google
// refuses them (a 429, see google-news.js), its pages can't be read: chosen, it is a card lost (5 of 10
// in a briefing of 129 on 7.10.2026). It is not a candidate then, unless its address is known already
const readableNow = (story) => googleAvailable('articles')
    || story.members.some(article => !fromGoogle(article) || article.resolved_link);
const siteOf = (article) => hostOf(article.source_url ?? article.link) ?? '';
const mediumOfArticle = (article) => mediumOf(siteOf(article));
const addressOf = (article) => article.resolved_link ?? article.link;

// trusted: the media the reader trusts
const isTrusted = (article, trusted) => trusted.has(mediumOfArticle(article));

// {thumbnail, thumbnailSource} of the first of these articles with a picture: the one its feed gave,
// else the one its page gives to be shared (og:image, see crawlers.js) when it was read. Only 23 of
// 82 cards of 3 days had one from the feeds (8.10.2026)
export const pictureOf = (articles, content = new Map()) => {
    for (const article of articles) {
        const thumbnail = article.thumbnail ?? content.get(article.link)?.thumbnail ?? null;
        if (thumbnail) return {thumbnail, thumbnailSource: siteOf(article)};
    }
    return {thumbnail: null, thumbnailSource: null};
};

const toArticle = (article, trusted = new Set()) => ({
    title: article.title,
    url: addressOf(article),        // a link of Google News not decoded: the browser follows it
    source: siteOf(article),
    publishedAt: article.at?.toISOString?.() ?? null,
    trusted: isTrusted(article, trusted),           // of a medium the reader trusts
    language: article.lang ?? null,                 // the language it is written in, shown by its source
});

// the articles of a story to read: one of a source the reader trusts first (the summary is written
// from the first one that can be read), else its best one when written in the language of the reader,
// else the newest one in that language (one of a feed before one of Google News, whose address must be
// asked), else its best one; then one per other medium, the newest first. The articles in the
// language of the reader come from its versions (see VERSION_LIKENESS): a story is of one language.
// A medium met through its feed and through Google News is read from its feed: no address to ask
// Google for
// A story shown before that evolved since (see repeats.js) is read from its news since: the card tells
// what is new, not what the reader read
const toRead = (story, trusted = new Set(), language = null) => {
    const inLanguage = (article) => Boolean(language) && article.lang === language;
    const since = story.followUp?.evolved ? new Date(story.followUp.shownAt) : null;
    const fresh = since ? story.members.filter(article => article.at > since) : [];
    const members = fresh.length > 0 ? fresh : story.members;
    const best = members.includes(story.best) ? story.best : members[0];
    const newest = [...members].sort((a, b) => b.at - a.at);
    const first = members.find(article => isTrusted(article, trusted) && !fromGoogle(article))
        ?? members.find(article => isTrusted(article, trusted))
        ?? (inLanguage(best) ? best : null)
        ?? newest.find(article => inLanguage(article) && !fromGoogle(article))
        ?? newest.find(inLanguage)
        ?? best;
    const byMedium = new Map();
    for (const article of [first, best, ...newest, ...story.members]) {
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
// 'across': the versions of each story in other languages (see versionsAcross), Map storyId -> [story]:
// their best news are checked with the articles of the story, and the ones telling its news join the
// card with their articles
const keepSameNews = async (stories, usage, versions = [], across = new Map()) => {
    const asked = stories
        .map(story => {
            const others = toCheck(story);
            const links = new Set([story.best, ...others].map(article => article.link));
            return {story, others, foreign: (across.get(story.storyId) ?? []).filter(version => !links.has(version.best.link))};
        })
        .filter(({others, foreign}) => others.length + foreign.length > 0);
    const [checked, merges] = await Promise.all([
        checkStories(asked.map(({story, others, foreign}) => ({
            id: String(story.storyId),
            lead: brief(story.best, DESCRIPTION_CHARS),
            others: [...others, ...foreign.map(version => version.best)].map(article => brief(article, CHECKED_DESCRIPTION_CHARS)),
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

    const kept = new Map(asked.map(({story, others, foreign}) => {
        const same = checked.get(String(story.storyId));
        return [story.storyId, same ? {
            others: others.filter((_, i) => same.has(i + 1)),
            foreign: foreign.filter((_, i) => same.has(others.length + i + 1)),
        } : null];
    }));
    let joinedAcross = 0;
    const cards = stories.map(story => {
        const same = kept.get(story.storyId);
        if (!same) return {...story};
        const members = [story.best, ...same.others];
        const links = new Set(members.map(article => article.link));
        for (const article of same.foreign.flatMap(version => version.members)) {
            if (links.has(article.link)) continue;
            links.add(article.link);
            members.push(article);
        }
        joinedAcross += same.foreign.length;
        return {...story, members, mergedStoryIds: [...(story.mergedStoryIds ?? []), ...same.foreign.map(version => version.storyId)]};
    });
    if (joinedAcross > 0) console.log(`Briefing: ${joinedAcross} versions in other languages joined their card`);

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

// the versions of the chosen stories in the other languages (see ACROSS_LIKENESS), with the news of
// them the reader can read: Map storyId -> [{storyId, best, members}]
const acrossOf = async (stories, {language, feedUrls, since}) => {
    const rows = await StoryModel.versionsAcross({
        storyIds: stories.map(story => story.storyId), language, feedUrls, since,
        likeness: ACROSS_LIKENESS, perStory: ACROSS_PER_STORY,
    });
    const chosen = new Set(stories.map(story => story.storyId));
    const ids = [...new Set(rows.map(row => row.id_version))].filter(id => !chosen.has(id));
    if (ids.length === 0) return new Map();
    const members = new Map(ids.map(id => [id, []]));
    for (const article of await StoryModel.storyArticles({storyIds: ids, feedUrls, since})) {
        members.get(article.id_story).push(article);
    }
    const byStory = new Map();
    for (const row of rows.filter(row => members.get(row.id_version)?.length > 0)) {
        const news = members.get(row.id_version);
        byStory.set(row.id_story, [...(byStory.get(row.id_story) ?? []), {storyId: row.id_version, best: news[0], members: news}]);
    }
    return byStory;
};

// what a card says, given with it to the AI that looks for its official source: its shorter passages
const OFFICIAL_TEXT = 700;
const textOf = (value) => Array.isArray(value) ? value.join(' ') : String(value ?? '');

// the other titles of a card's articles, one per language first (see anglesPrompt)
const cardTitles = (story, title) => {
    const others = story.members.filter(article => article.title && article.title !== title);
    const perLanguage = [...new Map(others.map(article => [article.lang, article])).values()];
    return [...new Set([...perLanguage, ...others].map(article => article.title))].slice(0, CARD_TITLES);
};

// The cards as the AI judges their other angles (see otherAnglesOf): [{id, title, titles, at, others:
// [{storyId, article, title, at, media, named}]}], the closest stories first, then the ones found by
// the card's rare names only (named). Of each story its newest news of a feed (one of Google News must
// be asked for its address), none of a link on a card
export const angleCardsOf = async (stories, titles, {feedUrls, hours}) => {
    const since = new Date(Date.now() - Math.max(hours, ANGLES_DAYS * 24) * 3600e3);
    const shown = new Set(stories.flatMap(story => [story.storyId, ...(story.mergedStoryIds ?? []),
        ...story.members.map(article => article.id_story)]).filter(Boolean));
    const links = new Set(stories.flatMap(story => story.members.map(article => article.link)));
    // each card compared with every story of the days apart (206 000 in 3 days on 8.10.2026, 1.4 s
    // a card): several at a time, a card failing leaves the others
    const rows = (await mapWithConcurrency(stories, ANGLE_QUERIES, story => StoryModel.closeStories({
        storyIds: [story.storyId], excluded: [...shown], feedUrls, since,
        likeness: ANGLE_LIKENESS, perStory: ANGLE_CANDIDATES * 2,
    }))).flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const named = await storiesOfSameNames(stories, {feedUrls, since: new Date(Date.now() - AFFAIR_DAYS * 24 * 3600e3),
        excluded: [...shown], perStory: ANGLE_CANDIDATES + NAMED_CANDIDATES}).catch(err => {
        console.error(`Briefing: no story of the same names looked for (${err.message})`);
        return new Map();
    });
    const namedRows = [...named].flatMap(([id, others]) => others.map(other => ({id_story: id, id_other: other.id_story, id_article: other.id_article})));
    const ids = [...new Set([...rows, ...namedRows].map(row => row.id_other))];
    if (ids.length === 0) return [];
    const members = new Map(ids.map(id => [id, []]));
    const oldest = namedRows.length > 0 ? new Date(Date.now() - AFFAIR_DAYS * 24 * 3600e3) : since;
    for (const article of await StoryModel.storyArticles({storyIds: ids, feedUrls, since: oldest})) {
        if (!links.has(article.link)) members.get(article.id_story).push(article);
    }
    const newsOf = (id) => members.get(id).find(article => !fromGoogle(article)) ?? members.get(id)[0] ?? null;
    // the closest stories, then the ones naming its rare names that are not among them, by their news
    // naming them: the newest of a story of every federation's stance on Infantino named another one
    const othersOf = (story) => {
        const closest = rows.filter(row => row.id_story === story.storyId && newsOf(row.id_other)).slice(0, ANGLE_CANDIDATES);
        const close = new Set(closest.map(row => row.id_other));
        const naming = namedRows.filter(row => row.id_story === story.storyId && !close.has(row.id_other) && newsOf(row.id_other))
            .slice(0, NAMED_CANDIDATES);
        return [...closest, ...naming].map(row => {
            const article = members.get(row.id_other).find(news => row.id_article && news.id === row.id_article) ?? newsOf(row.id_other);
            return {storyId: row.id_other, article, title: article.title, at: article.at,
                media: new Set(members.get(row.id_other).map(mediumOfArticle)).size, named: !close.has(row.id_other)};
        });
    };
    return stories.map((story, i) => ({
        id: story.storyId,
        title: titles[i],
        titles: cardTitles(story, titles[i]),
        at: story.best?.at ?? null,
        others: othersOf(story),
    }));
};

// The other angles of each card, the closest first: [{title, url, source, publishedAt, trusted,
// language, titleTranslation, storyId, media}] by story id (see angleCardsOf, placeAngles); a story an
// angle of two cards is shown below the first one. The titles in another language than the reader's
// translated
export const anglesOf = async (stories, titles, {language, feedUrls, hours, trusted, usage}) => {
    const cards = await angleCardsOf(stories, titles, {feedUrls, hours});
    if (cards.length === 0) return new Map();
    const judged = await otherAnglesOf(cards, usage);
    // the likeness of the angles the AI says tell the same fact as an earlier one (see sameFactsOut)
    const repeats = [...judged.values()].flat().filter(other => other.sameAs);
    const likeness = new Map(repeats.length === 0 ? [] : (await StoryModel.likenessAmong([...new Set(repeats.flatMap(other => [other.storyId, other.sameAs]))])
        .catch(err => {
            console.error(`Briefing: the angles telling one fact were not compared (${err.message})`);
            return [];
        })).map(row => [`${row.a}:${row.b}`, row.likeness]));
    const likenessOf = (a, b) => likeness.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0;
    const placed = new Set();
    const angles = new Map(cards.map(card => {
        const shown = placeAngles(sameFactsOut((judged.get(card.id) ?? []).filter(other => !placed.has(other.storyId)), likenessOf));
        shown.forEach(other => placed.add(other.storyId));
        return [card.id, shown];
    }));

    const foreign = [...angles.values()].flat()
        .filter(other => other.article.lang && other.article.lang !== language && writtenIn(other.article.lang) && writtenIn(language));
    const translations = foreign.length === 0 ? [] : await translateTexts(foreign.map(other => ({text: other.title, from: writtenIn(other.article.lang)})),
        writtenIn(language), usage).catch(() => foreign.map(() => null));
    return new Map([...angles].map(([id, others]) => [id, others.map(other => ({
        ...toArticle(other.article, trusted),
        titleTranslation: translations[foreign.indexOf(other)] ?? null,
        storyId: other.storyId,
        media: other.media,
    }))]));
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

// Chosen stories read: their texts say who wrote them and give the summary. Their pages are added to
// 'content' (link -> page), which counts who wrote each card. Answers [{story, unreadable, summary}]:
// unreadable when no article of the story could be read in full (a paywall, a protected site, its
// first lines only), summary null when the AI failed on a page read. A story of Google News only
// whose page is no news is left out
export const readStories = async (chosen, {trusted = new Set(), language = null, usage, content = new Map(), first = false, step = async () => {}}) => {
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
    for (const article of stories.flatMap(story => story.members)) {
        if (readable(article) && byAddress.has(addressOf(article))) content.set(article.link, byAddress.get(addressOf(article)));
    }

    // the key passages of each story, as published (see extract.js), translated for a reader of
    // another language; and the denials of its news its articles report (see contested.js), asked
    // together
    if (first) await step('summarizing');
    const summaries = await mapWithConcurrency(stories, AI_CONCURRENCY, async (story, i) => {
        // the first lines of a page (a teaser, a paywall) do not tell the news
        const lead = reads[i].find(article => canSummarize(content.get(article.link)?.content));
        if (!lead) return {unreadable: true};
        const texts = reads[i].filter(article => content.has(article.link))
            .map(article => ({...toArticle(article), page: content.get(article.link)}));
        const [{passages, translation, points, pointsTranslation, digest, digestTranslation, topic, sourcing}, contested] = await Promise.all([
            extractArticle(lead.title, content.get(lead.link), {language, usage: usage.summarizing}),
            contestedOf(lead.title, texts, {language, usage: usage.contesting}).catch(err => {
                console.error(`Briefing: the denials of story ${story.storyId} were not read (${err.message})`);
                return [];
            }),
        ]);
        // no passage of the news in its page: what was read is not the article
        if (passages.length === 0) return {unreadable: true};
        return {summary: {summary: passagesText(passages), translation: passagesText(translation),
            points: passagesText(points), pointsTranslation: passagesText(pointsTranslation),
            digest: passagesText(digest), digestTranslation: passagesText(digestTranslation),
            topic, sourcing, contested, from: lead.link}};
    });
    return stories.map((story, i) => summaries[i].status === 'fulfilled'
        ? {story, unreadable: Boolean(summaries[i].value.unreadable), summary: summaries[i].value.summary ?? null}
        : {story, unreadable: false, summary: null});
};

// the closest story of each thread, the stories in their order: an affair followed over days is one card
const oncePerThread = async (stories) => {
    const threads = new Map((await StoryModel.threadsOf(stories.map(story => story.storyId))).map(row => [row.id, row.id_thread]));
    const seen = new Set();
    return stories.filter(story => {
        const thread = threads.get(story.storyId);
        if (thread === null || thread === undefined) return true;
        if (seen.has(thread)) return false;
        seen.add(thread);
        return true;
    });
};

// the stories without the ones the profile sent itself by e-mail in the last REPEAT_HOURS (a card not
// sent was not read), the ones that evolved since kept as follow-ups (see repeats.js). The briefing
// never fails on it: all are kept then
const notShownBefore = async (stories, profileId, usage) => {
    try {
        const shown = shownStories(await BriefingModel.sentSince(profileId, new Date(Date.now() - REPEAT_HOURS * 3600e3)));
        if (shown.size === 0) return stories;
        const threads = await StoryModel.threadsOf([...new Set([...stories.map(story => story.storyId), ...shown.keys()])]);
        const threadOf = new Map(threads.map(row => [row.id, row.id_thread]));
        const result = await withoutRepeats(stories, shown, threadOf, (asked) => evolvedStories(asked, usage));
        console.log(`Briefing: ${result.left} stories of the affairs sent in the last ${REPEAT_HOURS} h left out, ${result.back.length} kept as they tell something new${
            result.back.map(({storyId, fact}) => `
  [${storyId}] ${fact ?? ''}`).join('')}`);
        return result.stories;
    } catch (err) {
        console.error(`Briefing: the stories shown before were not looked for (${err.message})`);
        return stories;
    }
};

// The profile as the AI reads it to choose and review the cards: its text, then the projects it runs
// (db/add_projects.sql), each in the reader's words, so a story on a project is not off the profile.
// The text of the profile alone when it runs none, as on the benches
export const readerText = (text, projects = []) => projects.length === 0 ? text : `${text}

En ce moment, il prépare aussi ${projects.length === 1 ? 'un projet, dont il veut les nouvelles' : 'des projets, dont il veut les nouvelles'} tant qu'${projects.length === 1 ? 'il dure' : 'ils durent'} :
${projects.map(project => `- « ${project.name} » : ${project.text.replace(/\s+/g, ' ').trim()}`).join('\n')}`;

// hours: of news it is written from, one of WINDOWS; size: its cards, one of BRIEFING_SIZES. Exported for the benches, which write a briefing
// without saving it (bench/briefing-relevance.mjs)
export const write = async (briefingId, profileId, hours, size = MAX_BRIEFING) => {
    // the stories ranked and given to the AI grow with the cards wanted
    const scale = size / MAX_BRIEFING;
    const usage = {repeats: newUsage(), choosing: newUsage(), checking: newUsage(), merging: newUsage(), summarizing: newUsage(), contesting: newUsage(), reviewing: newUsage(), angles: newUsage(), official: newUsage()};
    // the interests of the profile and of the projects it runs: each gets its share of the cards
    const [profile, interests, projects] = await Promise.all([ProfileModel.get(profileId), ProfileModel.briefingInterests(profileId),
        ProfileModel.projects(profileId)]);
    if (!profile || interests.length === 0) throw Object.assign(new Error('Write your profile first.'), {status: 400});
    const wanted = readerText(profile.text, projects.filter(project => project.running));

    // the seconds of each step, logged with the tokens: a slow briefing says where its time went. A
    // briefing of the benches (no id) is timed too but has no row to save its step in
    const seconds = {};
    let current = null, started = Date.now();
    const step = async (name) => {
        if (current) seconds[current] = Math.round((Date.now() - started) / 1000);
        [current, started] = [name, Date.now()];
        if (name && briefingId) await BriefingModel.step(briefingId, name);
    };

    // 1. the stories of the last hours closest to the interests: scored in the
    // database, where the vectors are (see rank_stories in db/add_briefing.sql)
    await step('ranking');
    const since = new Date(Date.now() - hours * 3600e3);
    const week = hours >= WEEK_FROM_HOURS;
    // the sources found for the profile that bring nothing on it any more are removed first; the
    // briefing never waits on it failing
    await DiscoveryService.prune(profileId).catch(err => console.error(`Briefing: the sources were not pruned (${err.message})`));
    // the thumbs of the reader: examples for the choice, and the sources found for the profile whose
    // cards were refused again and again are left out
    const feedback = await FeedbackService.of(profileId);
    const refused = new Set(feedback.refused);
    const allFeeds = await feedsOf(profileId);
    const feedUrls = allFeeds.filter(url => !refused.has(url));
    // the media the reader trusts: their stories among the TRUST_POOL closest are candidates too
    const trusted = new Set(await FeedModel.trustedMedia(profileId));
    const ranked = shareOut(await StoryModel.rank({
        profileId, feedUrls, since,
        languages: null,
        sparseWeight: SPARSE_WEIGHT,
        limit: RANKED_POOL * scale,
    }), RANKED * scale, row => row.id_interest, interests);
    if (ranked.length === 0) {
        throw new Error(`No story to choose from: the news of the last ${spanOf(hours)} are not read and embedded yet. The background work runs every few minutes, try again soon.`);
    }

    // the news of those stories the user can read, with the one that scored the best
    const members = new Map(ranked.map(row => [row.id_story, []]));
    for (const article of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) {
        members.get(article.id_story).push(article);
    }
    const media = await established();
    const byId = new Map(ranked.map((row, rank) => {
        const news = members.get(row.id_story);
        return [String(row.id_story), {
            storyId: row.id_story,
            best: news.find(article => article.id === row.id_article) ?? news[0],
            interestId: row.id_interest,
            interest: interests.find(interest => interest.id === row.id_interest)?.text ?? null,
            // the project of the interest, null for one of the profile itself
            project: interests.find(interest => interest.id === row.id_interest)?.project ?? null,
            members: news,
            score: Number(row.score),
            // told by a medium the reader trusts: the AI is told so; a candidate besides the closest
            // among the TRUST_POOL first only
            told: news.some(article => isTrusted(article, trusted)),
            pooled: rank < TRUST_POOL,
        }];
    }));
    const closestFirst = [...byId.values()]
        .filter(story => story.best && credibleStory(story.members, media) && !isRepeatedPage(story.members) && readableNow(story))
        .sort((a, b) => b.score - a.score);
    // the stories shown in the briefings of the last days are left out, unless they evolved since
    const fresh = await notShownBefore(closestFirst, profileId, usage.repeats);
    for (const story of fresh) byId.set(String(story.storyId), story);
    const choosable = week ? await oncePerThread(fresh) : fresh;
    const closest = pickCandidates(choosable, {
        fromFeeds: CANDIDATES * scale, extra: GOOGLE_CANDIDATES * scale, perMedium: GOOGLE_PER_MEDIUM,
        first: (stories, size) => shareOut(stories, size, story => story.interestId, interests),
    });
    const kept = new Set([...closest, ...choosable.filter(story => story.told && story.pooled && !closest.includes(story)).slice(0, TRUSTED_CANDIDATES * scale)]);
    const candidates = choosable.filter(story => kept.has(story));

    // 2. the AI chooses, against the whole profile and what it refuses
    await step('choosing');
    const language = readerLanguage(profile);
    const chosenByAi = await selectStories(wanted, candidates.map(story => ({
        id: String(story.storyId),
        title: story.best.title,
        description: (story.best.description ?? '').slice(0, DESCRIPTION_CHARS),
        others: story.members.filter(article => article !== story.best).map(article => article.title).slice(0, 3),
        trusted: story.told,
        media: new Set(story.members.map(mediumOfArticle)).size,
    })), usage.choosing, feedback.examples, interests.map(interest => interest.text), week && hours / 24, size, language);
    const selected = balanceSelection(chosenByAi, id => byId.get(id)?.interestId, interests, size);
    if (selected.length === 0) return [];
    // the next stories the AI chose, in its order: they replace a card no article of which can be read
    const reserved = chosenByAi.filter(item => !selected.includes(item));

    // 3. the AI checks which articles of each story tell the news of its best one, and which versions
    // in the language of the reader tell the news of a card in another. The reserve with them: one of
    // them telling the news of a card joins it, never comes as a second card
    await step('checking');
    const picked = selected.map(item => ({...byId.get(item.id), why: item.why}));
    const reserve = reserved.map(item => ({...byId.get(item.id), why: item.why, reserve: true}));
    const [versions, across] = await Promise.all([
        versionsOf([...picked, ...reserve], {language, feedUrls, since}).catch(err => {
            console.error(`Briefing: no version in the language of the reader looked for (${err.message})`);
            return [];
        }),
        // the cards only: 4 lines more to check for each story of the reserve would read few of them
        acrossOf(picked, {language, feedUrls, since}).catch(err => {
            console.error(`Briefing: no version in the other languages looked for (${err.message})`);
            return new Map();
        }),
    ]);
    const checked = await keepSameNews([...picked, ...reserve], usage, versions, across);
    // two cards of one news joined leave a place: the next of the reserve is read with the cards
    const main = checked.filter(story => !story.reserve);
    const spare = checked.filter(story => story.reserve);
    main.push(...spare.splice(0, Math.max(0, picked.length - main.length)));
    console.log(`Briefing: the AI chose ${chosenByAi.length} of ${candidates.length} stories, ${main.length} for the cards and ${spare.length} in reserve once the same news joined`);

    // 4. and 5. the chosen stories read, then 6. their cards read once more with their summary, which
    // says what a title may not: the ones on what the reader refuses are left out (see reviewCards).
    // The ones of the reserve take the places of the stories that can't be read or are left out. The
    // briefing never waits on the review failing
    const content = new Map();
    const titleTranslation = new Map();
    let rounds = 0;
    const leadOf = (result) => result.story.members.find(article => article.link === result.summary?.from) ?? result.story.best;
    const read = async (chosen) => {
        const first = rounds++ === 0;
        if (first) await step('reading');
        const results = await readStories(chosen, {trusted, language, usage, content, first, step});
        const leads = new Map(results.filter(result => !result.unreadable).map(result => [result, leadOf(result)]));
        // and the titles written in another language than the reader's translated, as their passages
        const foreign = [...leads.values()].filter(lead => lead.lang && lead.lang !== language && writtenIn(lead.lang) && writtenIn(language));
        const [leftOut, translations] = await Promise.all([
            reviewCards(wanted, [...leads].map(([result, lead]) => ({
                id: String(result.story.storyId),
                title: lead.title,
                summary: result.summary?.summary ?? null,
            })), usage.reviewing, {interests: interests.map(interest => interest.text), refused: profile.refused ?? []}).catch(err => {
                console.error(`Briefing: the cards were not read again (${err.message})`);
                return new Map();
            }),
            foreign.length === 0 ? [] : translateTexts(foreign.map(lead => ({text: lead.title, from: writtenIn(lead.lang)})),
                writtenIn(language), usage.summarizing),
        ]);
        foreign.forEach((lead, i) => titleTranslation.set(lead, translations[i]));
        if (leftOut.size > 0) console.log(`Briefing: ${leftOut.size} cards on what the reader refuses left out (${[...leftOut.values()].join(' / ')})`);
        return results.map(result => ({...result, leftOut: leftOut.get(String(result.story.storyId)) ?? null}));
    };
    const {cards, unreadable, leftOut} = await readableCards(main, spare, read);
    if (unreadable + leftOut > 0) console.log(`Briefing: ${unreadable} chosen stories could not be read and ${leftOut} were left out, ${cards.filter(card => card.story.reserve).length} of the reserve took their place`);
    const stories = cards.map(card => card.story);
    const summaryOf = (i) => cards[i].summary;
    const leads = cards.map(leadOf);
    // 7. the other angles of the cards, their official sources, the people and organisations they name,
    // and the news of what the profile follows beside them. The briefing never waits on any of them failing
    await step('angles');
    const [angles, official, watched, names] = await Promise.all([
        anglesOf(stories, leads.map(lead => lead.title), {language, feedUrls, hours, trusted, usage: usage.angles}).catch(err => {
            console.error(`Briefing: no other angle looked for (${err.message})`);
            return new Map();
        }),
        officialSourcesOf(stories.map((story, i) => ({
            id: story.storyId,
            title: leads[i].title,
            titleTranslation: titleTranslation.get(leads[i]) ?? null,
            titles: cardTitles(story, leads[i].title),
            text: textOf(summaryOf(i)?.digest ?? summaryOf(i)?.summary ?? leads[i].description).slice(0, OFFICIAL_TEXT),
            first: new Date(Math.min(...story.members.map(article => article.at?.getTime?.() ?? Date.now()))).toISOString(),
            // its articles read, for the statements of its parties they report (see statements.js)
            texts: [leads[i], ...story.members.filter(article => article !== leads[i])].filter(article => content.has(article.link))
                .map(article => ({...toArticle(article), page: content.get(article.link), lead: article === leads[i]})),
        })), usage.official, {language}).catch(err => {
            console.error(`Briefing: no official source looked for (${err.message})`);
            return new Map();
        }),
        // from every feed, the ones the thumbs left out too: the reader asked for all of them. The items
        // followed first, then the names and words as written
        followedNews(profileId, profile.watch_terms ?? [], {feedUrls: allFeeds, since, hours}).catch(err => {
            console.error(`Briefing: the news of what the profile follows were not looked for (${err.message})`);
            return null;
        }),
        namesOfCards(stories.map(story => ({storyId: story.storyId, ids: story.members.map(article => article.id),
            media: [...new Set(story.members.map(mediumOfArticle))]}))).catch(err => {
            console.error(`Briefing: the names of the cards were not read (${err.message})`);
            return new Map();
        }),
    ]);
    if (briefingId && watched) await BriefingModel.watched(briefingId, watched);
    await step(null);
    console.log(`Briefing ${briefingId}: tokens ${JSON.stringify(usage)}, seconds ${JSON.stringify(seconds)}`);

    return stories.map((story, i) => {
        const summary = summaryOf(i);
        const lead = leads[i];
        const members = [...story.members].sort((a, b) => b.at - a.at);

        return {
            storyId: story.storyId,
            mergedStoryIds: story.mergedStoryIds ?? [],   // cards of the same news joined to this one
            // a card of a briefing of the last days it follows (see repeats.js): {storyId, title, shownAt,
            // evolved}, evolved when it is that story with news since, else a new step of its affair
            followUp: story.followUp ?? null,
            vote: null,                                    // the thumb of the reader, 'up' or 'down'
            // the feeds its articles came from: a refused card is blamed on them (utils/feedback.js),
            // never on a search of Google News, which is the interest itself
            feedUrls: [...new Set(story.members.map(article => article.feed_url).filter(url => url && !isGoogleNewsUrl(url)))],
            title: lead.title,
            // the article of the title and of the passages, the one the card sends to read: the reader
            // could not tell which of its articles the passages were of
            lead: toArticle(lead, trusted),
            // the title in the language of the reader when it is written in another, and that language
            titleTranslation: titleTranslation.get(lead) ?? null,
            language: lead.lang ?? null,
            why: story.why,
            interest: story.interest,
            // the project of the profile it was chosen for (see readerText), null for the profile itself
            project: story.project ?? null,
            // the key sentences of the article as published, a paragraph per passage (see extract.js)
            summary: summary?.summary ?? null,
            // a card is read (see readableCards): without passages, the AI failed on its article
            summaryError: summary ? null : 'The passages of its article could not be chosen: the AI did not answer.',
            // their machine translation, when the article is not in the language of the reader
            translation: summary?.translation ?? null,
            // the shorter ways the reader can choose, of the same sentences (see shorterWays): the most
            // important ones a paragraph each, and the ones of 5 to 6 lines; with their translation.
            // Absent from the briefings made before 12.10.2026
            points: summary?.points ?? null,
            pointsTranslation: summary?.pointsTranslation ?? null,
            digest: summary?.digest ?? null,
            digestTranslation: summary?.digestTranslation ?? null,
            topic: summary?.topic ?? null,
            sourcing: summary?.sourcing ?? null,
            // the words the article itself used to say it has no confirmation
            hedged: hedgedBy(lead.title, lead.description),
            // someone named who denies the news, in the words of one of its articles:
            // [{by, sentence, translation, language, source, url, publishedAt}]
            contested: summary?.contested ?? [],
            // news of the same affair telling something the card does not, the closest first (see
            // anglesOf): [{title, titleTranslation, url, source, language, publishedAt, media, ...}]
            angles: angles.get(story.storyId) ?? [],
            // the posts where a party of the news said it itself, on its website or an open account of
            // its own (see official-sources.js): [{party, title, url, channel, publishedAt}]; then its
            // statements one of the card's articles reports (channel 'reported': title the sentence,
            // translation, language, source the medium). Absent from the briefings made before 12.10.2026
            official: official.get(story.storyId) ?? [],
            // the people and organisations most of its articles name, each opening its page (see
            // card-names.js): [{name, qid, kind}], qid null for a name Wikidata does not have as one item.
            // Absent from the briefings made before 13.10.2026
            names: names.get(story.storyId) ?? [],
            // the picture of its lead article when it has one, else of its newest article with one;
            // and the site it is of, shown under it
            ...pictureOf([lead, ...members], content),
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
            articles: onceEach([...members].sort((a, b) => isTrusted(b, trusted) - isTrusted(a, trusted)),
                {medium: mediumOfArticle, fromGoogle})
                .map(article => toArticle(article, trusted)),
        };
    });
};

// The news of the terms the profile follows (names or words, see cleanWatchTerms): every news of the
// window its feeds gave that names one in its title or description, as a whole word, its accents and
// case aside (as the exact words of a search, see Filter). Not chosen by the AI nor read, whatever their
// relevance, from every feed (the ones the thumbs left out too): the reader asked for all of them. One
// line per story, its newest news, with how many media told it, the WATCHED_PER_TERM newest kept (the
// user's choice, 8.10.2026: 100), all counted.
// [{term, count, news: [{storyId, title, url, source, language, publishedAt, media, excerpt}]}]
const WATCHED_PER_TERM = 100;

// The words of the description around the term, when the title does not name it: the line would not
// say why it is there. null when the title names it, or the description does not
const EXCERPT_BEFORE = 90;
const EXCERPT_AFTER = 110;
export const excerptOf = (title, description, term) => {
    if (!description || Filter.highlights(title, [term]).length > 0) return null;
    const [first] = Filter.highlights(description, [term]);
    if (!first) return null;
    let start = Math.max(0, first[0] - EXCERPT_BEFORE);
    let end = Math.min(description.length, first[1] + EXCERPT_AFTER);
    // cut between two words
    if (start > 0) start = description.indexOf(' ', start) + 1 || start;
    if (start > first[0]) start = first[0];
    if (end < description.length) end = Math.max(first[1], description.lastIndexOf(' ', end));
    return `${start > 0 ? '…' : ''}${description.slice(start, end).trim()}${end < description.length ? '…' : ''}`;
};
export const watchedNews = async (terms, {feedUrls, since}) => {
    if (terms.length === 0) return [];
    const articles = await FeedModel.searchArticles({
        feedUrls, keywords: Filter.parse([terms.map(term => `"${term}"`).join(', ')]), timeframe: {start: since},
    });
    return newsOfTerms(terms, articles);
};

// The news of what the profile follows (see EntityService): the items of Wikidata it wants in its
// briefing, by the names the tagger found in each news, in any language, then its words, by their text.
// [{term, qid, count, news}], qid null for a word
const followedNews = async (profileId, words, {feedUrls, since, hours}) => [
    ...await EntityService.briefingGroups(profileId, hours),
    ...(await watchedNews(words, {feedUrls, since})).map(group => ({...group, qid: null})),
];

// the articles whose title or description names a term as a whole word
export const namingTerm = (term) => {
    const names = Filter.matcher(Filter.parse([`"${term}"`]));
    return (article) => names(`${article.title} ${article.description ?? ''}`);
};

// [{term, count, news}]: the articles naming each term, one news per story, the newest first (articles:
// the newest first), 'limit' news kept per term, all counted. holds(term): the test of an article
// naming it, a whole word of its text when not given (the entities give the names the tagger found)
export const newsOfTerms = (terms, articles, {limit = WATCHED_PER_TERM, holds = namingTerm} = {}) => {
    return terms.map(term => {
        const names = holds(term);
        const stories = new Map();
        for (const article of articles) {
            if (!names(article)) continue;
            const key = article.id_story ?? `article ${article.id}`;
            const story = stories.get(key) ?? {article, media: new Set()};
            story.media.add(mediumOfArticle(article));
            stories.set(key, story);
        }
        return {
            term,
            count: stories.size,
            news: [...stories.values()].slice(0, limit).map(({article, media}) => ({
                storyId: article.id_story ?? null,
                title: article.title,
                url: addressOf(article),
                source: siteOf(article),
                language: article.lang ?? null,
                publishedAt: (article.published_at ?? article.created_at)?.toISOString?.() ?? null,
                media: media.size,
                excerpt: excerptOf(article.title, article.description, term),
            })),
        };
    });
};

const toBriefing = (row) => row && ({
    id: row.id,
    status: row.status,             // running, ready, failed
    step: row.step,                 // ranking, choosing, reading, summarizing
    error: row.error,
    items: row.items ?? [],
    // the news of the terms the profile follows (see watchedNews), null for a briefing written before
    watched: row.watched ?? null,
    size: row.size ?? MAX_BRIEFING,  // the cards asked for
    hours: row.hours,               // of news it was written from
    createdAt: row.created_at,
    finishedAt: row.finished_at,
});

// The places of the names the profile follows in the texts the page shows (see Filter.highlights), the
// ones it follows now: {field: [[start, end]]}, the fields without any left out
const marksOf = (fields, terms) => Object.fromEntries(Object.entries(fields)
    .map(([field, text]) => [field, Filter.highlights(text, terms)])
    .filter(([, ranges]) => ranges.length > 0));

// What the profile follows a card names, in the order it follows them: [{term, qid, angle}], term the
// label of the item or the word, angle when only one of its other angles names it (see anglesOf), not
// the card itself (title, passages, denials)
const foundIn = (item, follows) => {
    const names = (texts, follow) => texts.some(text => Filter.highlights(text, follow.names).length > 0);
    const own = [item.title, item.titleTranslation, item.summary, item.translation,
        ...(item.contested ?? []).flatMap(denial => [denial.sentence, denial.translation])];
    const angles = (item.angles ?? []).flatMap(angle => [angle.title, angle.titleTranslation]);
    return follows.flatMap(follow => names(own, follow) ? [{term: follow.label, qid: follow.qid ?? null, angle: false}]
        : names(angles, follow) ? [{term: follow.label, qid: follow.qid ?? null, angle: true}] : []);
};

// follows: [{label, qid, names}] (see EntityService.followTerms), or the words alone
export const withMarks = (briefing, followed) => {
    if (!briefing || !followed?.length) return briefing;
    const follows = followed.map(follow => typeof follow === 'string' ? {label: follow, qid: null, names: [follow]} : follow);
    const terms = [...new Set(follows.flatMap(follow => follow.names))];
    return {
        ...briefing,
        items: briefing.items.map(item => ({
            ...item,
            marks: marksOf({title: item.title, titleTranslation: item.titleTranslation, summary: item.summary, translation: item.translation,
                points: item.points, pointsTranslation: item.pointsTranslation, digest: item.digest, digestTranslation: item.digestTranslation}, terms),
            angles: (item.angles ?? []).map(angle => ({...angle, marks: marksOf({title: angle.title, titleTranslation: angle.titleTranslation}, terms)})),
            contested: (item.contested ?? []).map(denial => ({...denial, marks: marksOf({sentence: denial.sentence, translation: denial.translation}, terms)})),
            found: foundIn(item, follows),
        })),
        watched: briefing.watched?.map(group => ({
            ...group,
            news: group.news.map(news => ({...news, marks: marksOf({title: news.title, excerpt: news.excerpt}, terms)})),
        })) ?? null,
    };
};

// the cards with the titles the reader wrote for the e-mail, {storyId: title}: one left empty keeps its own
const MAX_OWN_TITLE = 300;
export const withOwnTitles = (items, titles) => {
    if (titles === undefined || titles === null) return items;
    if (typeof titles !== 'object' || Array.isArray(titles) || !Object.values(titles).every(title => typeof title === 'string')) {
        throw Object.assign(new Error('titles: {storyId: title}.'), {status: 400});
    }
    return items.map(item => {
        const own = (titles[String(item.storyId)] ?? '').replace(/\s+/g, ' ').trim();
        if (own.length > MAX_OWN_TITLE) throw Object.assign(new Error(`A title has ${MAX_OWN_TITLE} characters at most.`), {status: 400});
        return own ? {...item, ownTitle: own} : item;
    });
};

// the cards without the denials, the other angles and the official sources the reader took out of the
// e-mail, {storyId: {contested: [index], angles: [index], official: [index]}}, their places in the
// card: a part left empty has no title
const TAKEN_OUT = ['contested', 'angles', 'official'];
export const withoutTakenOut = (items, removed) => {
    if (removed === undefined || removed === null) return items;
    const places = (list) => Array.isArray(list) && list.every(index => Number.isInteger(index) && index >= 0);
    if (typeof removed !== 'object' || Array.isArray(removed) || !Object.values(removed).every(parts =>
        parts && typeof parts === 'object' && !Array.isArray(parts)
        && Object.entries(parts).every(([part, list]) => TAKEN_OUT.includes(part) && places(list)))) {
        throw Object.assign(new Error('removed: {storyId: {contested: [index], angles: [index], official: [index]}}.'), {status: 400});
    }
    return items.map(item => {
        const parts = removed[String(item.storyId)];
        if (!parts) return item;
        return {...item, ...Object.fromEntries(Object.entries(parts).map(([part, list]) =>
            [part, (item[part] ?? []).filter((entry, index) => !list.includes(index))]))};
    });
};

// {row, briefing} of a ready briefing of this reader, else 404
const readyBriefing = async (userId, briefingId) => {
    const id = Number(briefingId);
    const row = Number.isInteger(id) && id > 0 ? await BriefingModel.ofUser(userId, id) : null;
    if (!row || row.status !== 'ready') throw Object.assign(new Error('Unknown briefing.'), {status: 404});
    return {row, briefing: toBriefing(row)};
};

// The news a reader adds to a briefing by its link (see importNews), MAX_IMPORTED at most per briefing
const MAX_IMPORTED = 10;
const MAX_URL = 2000;
const dateOf = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

// the card of a news added by its link: its page read as the cards' are, its key passages chosen and
// translated as theirs; no story, no why, no other media, no angle nor official source
export const importedCard = async (address, page, {language, usage}) => {
    const title = (page.title || page.description || address).replace(/\s+/g, ' ').trim();
    const extract = await extractArticle(title, page, {language, usage});
    if (extract.passages.length === 0) {
        throw Object.assign(new Error('No passage of a news could be read in this page.'), {status: 422});
    }
    const lang = extract.from ?? languageOf(`${title} ${page.content.slice(0, 2000)}`);
    const [titleTranslation] = lang && lang !== language && writtenIn(lang) && writtenIn(language)
        ? await translateTexts([{text: title, from: writtenIn(lang)}], writtenIn(language), usage).catch(() => [null])
        : [null];
    const source = hostOf(address) ?? '';
    const lead = {title, url: address, source, publishedAt: dateOf(page.publishedAt), trusted: false, language: lang ?? null};
    const thumbnail = /^https?:\/\//i.test(page.thumbnail ?? '') ? page.thumbnail : null;
    return {
        imported: true,
        mergedStoryIds: [],
        vote: null,
        feedUrls: [],
        title,
        lead,
        titleTranslation: titleTranslation ?? null,
        language: lang ?? null,
        why: null,
        interest: null,
        summary: passagesText(extract.passages),
        summaryError: null,
        translation: passagesText(extract.translation),
        points: passagesText(extract.points),
        pointsTranslation: passagesText(extract.pointsTranslation),
        digest: passagesText(extract.digest),
        digestTranslation: passagesText(extract.digestTranslation),
        topic: extract.topic,
        sourcing: extract.sourcing,
        hedged: hedgedBy(title, page.description),
        contested: [],
        angles: [],
        official: [],
        thumbnail,
        thumbnailSource: thumbnail ? source : null,
        publishedAt: lead.publishedAt,
        articles: [lead],
    };
};

const picturesOfItem = async (item) => storyPictures(item,
    await BriefingModel.articlePictures(item.storyId, [item.lead, ...(item.articles ?? [])].filter(Boolean).map(article => article.url)));

export const BriefingService = {
    // the last briefing of this profile, running or not, the terms it follows marked in it
    latest: async (profileId) => {
        if (profileId === null) return null;
        const [row, profile] = await Promise.all([BriefingModel.latest(profileId), ProfileModel.get(profileId)]);
        return withMarks(toBriefing(row), await EntityService.followTerms(profileId, profile?.watch_terms));
    },

    // the cards of a ready briefing the reader ticked (storyIds), in the order the reader gave them (see
    // briefing-mail.js), sent to one address: to, the one the reader writes, the one of their account
    // when not given; sent to another, the answers go to the reader. Its title names the profile.
    // pictures: the picture of some cards changed or taken out (see withChosenPictures); titles:
    // {storyId: title}, the ones the reader wrote for the e-mail; removed: the denials, the other
    // angles and the official sources they took out (see withoutTakenOut); format: the way the
    // sentences of the cards are shown, one of MAIL_FORMATS, the key passages when not given. No copy
    // is kept any more: the e-mail has no link to one (the user, 13.10.2026)
    email: async (userId, briefingId, storyIds, to, pictures, titles, removed, format = 'passages') => {
        if (!Array.isArray(storyIds) || storyIds.length === 0 || !storyIds.every(storyId => Number.isInteger(storyId) && storyId !== 0)) {
            throw Object.assign(new Error('storyIds: the cards ticked, one at least.'), {status: 400});
        }
        if (!MAIL_FORMATS.includes(format)) throw Object.assign(new Error(`format: one of ${MAIL_FORMATS.join(', ')}.`), {status: 400});
        const asked = typeof to === 'string' ? to.trim() : to ?? '';
        if (asked !== '' && !isEmail(asked)) throw Object.assign(new Error(EMAIL_RULE), {status: 400});
        const {row, briefing} = await readyBriefing(userId, briefingId);
        const byId = new Map(briefing.items.map(item => [item.storyId, item]));
        // in the order given, each card once, the ones not in this briefing left out
        const ticked = [...new Set(storyIds)].map(storyId => byId.get(storyId)).filter(Boolean);
        if (ticked.length === 0) throw Object.assign(new Error('None of the cards ticked is in this briefing.'), {status: 404});
        const [user, profile] = await Promise.all([UserModel.email(userId), row.id_profile ? ProfileModel.get(row.id_profile) : null]);
        if (!asked && !user?.email) throw Object.assign(new Error('Your account has no e-mail address.'), {status: 400});
        const address = asked || user.email;
        const toOther = address.toLowerCase() !== String(user?.email ?? '').toLowerCase();
        const sender = toOther ? user?.username ?? null : null;
        // a picture of the story chosen is credited to its medium
        const changed = ticked.filter(item => pictures && typeof pictures === 'object' && typeof pictures[String(item.storyId)]?.url === 'string');
        const known = new Map((await Promise.all(changed.map(picturesOfItem))).flat().map(picture => [picture.url, picture.source]));
        const {items, attachments} = await withChosenPictures(withoutTakenOut(withOwnTitles(ticked, titles), removed), pictures, {sender, known});
        const mail = briefingMail({...briefing, items}, {profile: profile?.name ?? null, sender, format});
        await sendMail({to: address, replyTo: toOther && user?.email ? user.email : undefined, ...mail, attachments});
        // sent, they are read: their stories are left out of the next briefings (see notShownBefore). The
        // e-mail is gone already, a failure here only lets them come back
        await BriefingModel.markSent(userId, row.id, ticked.map(item => item.storyId)).catch(err =>
            console.error(`Briefing ${briefingId}: the cards sent were not marked (${err.message})`));
    },

    // A news the reader adds by its link to a ready briefing, to send it by e-mail with its cards: its page
    // read (a plain fetch, only of a public address), its key passages chosen by the AI and translated,
    // as a card at the end of the briefing marked as added (see importedCard). Its id is negative: it
    // is of no story. Answers the card, the terms the profile follows marked in it
    importNews: async (userId, briefingId, url) => {
        const asked = typeof url === 'string' ? url.trim() : '';
        if (!asked || asked.length > MAX_URL) throw Object.assign(new Error('url: the address of the news.'), {status: 400});
        const address = (await assertPublicUrl(asked)).href;
        const {row, briefing} = await readyBriefing(userId, briefingId);
        const known = (article) => article?.url === address || article?.url === asked;
        if (briefing.items.some(item => [item.lead, ...(item.articles ?? [])].some(known))) {
            throw Object.assign(new Error('This news is already in the briefing.'), {status: 409});
        }
        if (briefing.items.filter(item => item.imported).length >= MAX_IMPORTED) {
            throw Object.assign(new Error(`At most ${MAX_IMPORTED} news added to a briefing.`), {status: 400});
        }
        const [page] = await Crawlers.Pages([address]);
        if (!page?.content || !canSummarize(page.content)) {
            throw Object.assign(new Error('This page could not be read: no article in it, a paywall or a protected site.'), {status: 422});
        }
        const profile = row.id_profile ? await ProfileModel.get(row.id_profile) : null;
        const usage = newUsage();
        const card = await importedCard(address, page, {language: readerLanguage(profile ?? {}), usage});
        const storyId = await BriefingModel.addItem(userId, row.id, card);
        if (storyId === null) throw Object.assign(new Error('Unknown briefing.'), {status: 404});
        console.log(`Briefing ${row.id}: news added by its link, tokens ${JSON.stringify(usage)}`);
        return withMarks({items: [{...card, storyId}]}, await EntityService.followTerms(row.id_profile ?? null, profile?.watch_terms)).items[0];
    },

    // a news the reader added taken out of the briefing
    removeNews: async (userId, briefingId, storyId) => {
        const id = Number(briefingId);
        const story = Number(storyId);
        if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(story) || story >= 0
            || await BriefingModel.removeItem(userId, id, story) === 0) {
            throw Object.assign(new Error('Unknown news added.'), {status: 404});
        }
    },

    // {subject, html}: the copy of an e-mail kept as it was sent, by the token of its link: the e-mails
    // sent before 13.10.2026 carry one
    original: async (token) => {
        const copy = /^[\w-]{24}$/.test(String(token ?? '')) ? await SentMailModel.byToken(token) : null;
        if (!copy) throw Object.assign(new Error('No e-mail has this address.'), {status: 404});
        return copy;
    },

    // [{url, source}]: the pictures of a card of a ready briefing the reader can put in an e-mail
    pictures: async (userId, briefingId, storyId) => {
        const {briefing} = await readyBriefing(userId, briefingId);
        const item = briefing.items.find(card => card.storyId === Number(storyId));
        if (!item) throw Object.assign(new Error('Unknown card.'), {status: 404});
        return picturesOfItem(item);
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

    // a new briefing, written in background from the news of the last 'hours' (one of WINDOWS): the
    // answer is the briefing still running, the client asks for it again until it is ready. Only one
    // at a time per user
    // 'size': its cards, one of BRIEFING_SIZES
    start: async (userId, profileId, hours = DEFAULT_HOURS, size = MAX_BRIEFING) => {
        if (profileId === null) throw Object.assign(new Error('Write your profile first.'), {status: 400});
        if (!WINDOWS.includes(hours)) throw Object.assign(new Error(`hours: 1 to 7 days (${WINDOWS.join(', ')}).`), {status: 400});
        if (!BRIEFING_SIZES.includes(size)) throw Object.assign(new Error(`size: ${BRIEFING_SIZES.join(', ')}.`), {status: 400});
        await BriefingModel.failAbandoned(new Date(Date.now() - ABANDONED_MINUTES * 60 * 1000));
        if (running.has(profileId)) return toBriefing(await BriefingModel.running(profileId));

        const briefing = await BriefingModel.create(userId, profileId, hours, size);
        running.add(profileId);

        write(briefing.id, profileId, hours, size)
            .then(items => BriefingModel.finish(briefing.id, items))
            .catch(err => {
                console.error(`Briefing ${briefing.id} failed: ${err.stack ?? err}`);
                return BriefingModel.fail(briefing.id, err.message ?? String(err));
            })
            .finally(() => running.delete(profileId));

        return toBriefing(briefing);
    },
};
