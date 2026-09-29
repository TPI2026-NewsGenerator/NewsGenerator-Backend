//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: discovery-service.js
//  Description: The sources of a profile, found from its interests: the media that publish on them,
//               and in each medium the feed of its section on them
//

"use strict"

import {ProfileModel} from "../models/profile-model.js";
import {knownMedia} from "./source-service.js";
import {IngestService, searchesOfUser} from "./ingest-service.js";
import {FeedbackService} from "./feedback-service.js";
import {search} from "./utils/google-news.js";
import {findFeeds, isOnSubject, subjectScore} from "./utils/feed-finder.js";
import {embed, denseSimilarity, parseVector} from "./utils/embedder.js";
import {nameOf} from "./utils/public-url.js";
import {parseSearch} from "./utils/profile-ai.js";
import {allocate, staleFeeds, tryPerLanguage} from "./utils/allocation.js";
import {FeedModel} from "../models/feed-model.js";
import {bridgeRoom, MAX_NEW_PROFILE_FEEDS, MAX_PROFILE_FEEDS, withinBridgeRoom} from "./utils/feed-limits.js";

// Measured on four profiles: with the feeds of the project only, a private chef had 1 relevant
// story in 48 hours and a dog owner 2. The feeds found this way brought them to 8 and 32, and the
// choice of the section cut the chef's feeds from 167 news to 65 for the same relevant ones.
const SEARCH_DAYS = 7;              // a week of Google News says which media really write on it
// per interest and per language read, each medium tried costs a few requests (see tryPerLanguage)
const KEPT_PER_LANGUAGE = 2;
const TRIED_PER_LANGUAGE = 5;
const FIND_CONCURRENCY = 3;
// A news is on an interest when its cosine with the interest reaches this. Calibrated on the titles
// judged by hand: it keeps 57% of the fully relevant ones and 11% of the others, which is enough to
// tell a section from a general feed. Judging by keywords written by the AI changed from one run to
// the next; the meaning did not.
export const JUDGE_THRESHOLD = 0.45;
// A feed found for the profile stays while its news are on the profile: on the UEFA profile goal.com
// had 18 such news in 14 days, the latimes.com none in 99. It is removed when none of its news of
// these days is, once it had the time or the news to show it
export const RELEVANCE_DAYS = 14;
const MIN_NEWS = 30;

// the judge of findFeeds: which texts are on one of the interests of the profile, by meaning. A feed
// is kept for the whole profile, and judged on one interest alone a football feed rarely had two news
// on the governance of the UEFA among its last thirty: tribuna.com, kept one day, was lost the next.
// Texts seen for a medium are often seen again (its main feed), they are encoded once
const judgeOf = (interestDenses, cache) => async (texts) => {
    const missing = [...new Set(texts.filter(text => !cache.has(text)))];
    if (missing.length > 0) {
        (await embed(missing)).forEach((vector, i) => cache.set(missing[i], vector.dense));
    }
    return texts.map(text => interestDenses.some(dense => denseSimilarity(cache.get(text), dense) >= JUDGE_THRESHOLD));
};

// the media Google News names for the searches of an interest, the most present first
const mediaOf = async (searches) => {
    const media = new Map();

    for (const {lang, q} of searches.map(parseSearch).filter(Boolean)) {
        try {
            const found = await search([q], {days: SEARCH_DAYS, language: lang});
            for (const medium of found.media) {
                const key = nameOf(medium.site);
                const known = media.get(key) ?? {site: medium.site, name: medium.name, news: 0, lang};
                known.news += medium.news;
                media.set(key, known);
            }
        } catch (err) {
            console.log(`Discovery: Google News failed for "${q}" (${err.message})`);
        }
    }

    return [...media.values()].sort((a, b) => b.news - a.news);
};

// the feeds found for this profile that bring nothing on it any more, removed: the ones of an interest
// the reader took out, a section that changed, a feed that died. Answers how many
const prune = async (userId) => {
    const [rows, kept, trusted] = await Promise.all([
        ProfileModel.profileFeedRelevance(userId, {
            since: new Date(Date.now() - RELEVANCE_DAYS * 24 * 3600e3),
            threshold: JUDGE_THRESHOLD,
        }),
        ProfileModel.keptSources(userId),
        FeedModel.trustedFeedUrls(userId),
    ]);
    // the reader keeps the ones they kept from the thumbs and the ones they trust
    const stale = staleFeeds(rows, {graceDays: RELEVANCE_DAYS, minNews: MIN_NEWS, kept: [...kept, ...trusted]});
    if (stale.length === 0) return 0;

    console.log(`Discovery: ${stale.length} feeds of user ${userId} bring nothing on the profile, removed (${stale.map(row => row.site).join(', ')})`);
    return ProfileModel.deleteProfileFeeds(userId, stale.map(row => row.id));
};

const discover = async (userId) => {
    await prune(userId);
    const [interests, feeds, profileCount, profile] = await Promise.all([
        ProfileModel.interestsForDiscovery(userId),
        FeedModel.userFeedUrls(userId),
        FeedModel.countUserFeeds(userId, 'profile'),
        ProfileModel.get(userId),
    ]);
    const languages = profile?.languages?.length ? profile.languages : null;
    const room = Math.min(MAX_NEW_PROFILE_FEEDS, MAX_PROFILE_FEEDS - profileCount);
    if (room <= 0) {
        console.log(`Discovery: user ${userId} has ${profileCount} feeds for the profile already, none looked for`);
        return [];
    }

    // the feeds found before stay: only new media are looked for. Nor the ones whose cards the
    // reader refused again and again (see FeedbackService): not found twice
    const {refused} = await FeedbackService.of(userId);
    const known = await knownMedia(userId, {userFeeds: [...feeds, ...refused]});
    // A medium refused for one interest is tried again for the next: tribuna.com had 1 news in 30 on
    // the governance of the UEFA, was never judged on refereeing (7 in 30), and was lost. Only the
    // media already kept are not tried twice, their feed is already there
    const kept = new Set();
    const judge = judgeOf(interests.map(interest => parseVector(interest.dense)), new Map());
    const perInterest = [];

    for (const interest of interests) {
        const media = (await mediaOf(interest.searches))
            .filter(medium => !known.has(nameOf(medium.site)) && !kept.has(nameOf(medium.site)));

        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        const found = await tryPerLanguage(media, async (medium) => {
            const feed = await findFeeds(medium.site, {language: medium.lang, subject, judge, languages})
                .then(feeds => feeds[0], () => null);
            if (!feed || !isOnSubject(feed)) return null;
            // the language read in its news: tribuna.com/en/, found by a French search, is in English
            return {url: feed.url, site: medium.site, category: interest.category ?? 'world', language: feed.language ?? medium.lang,
                score: subjectScore(feed)};
        }, {kept: KEPT_PER_LANGUAGE, tried: TRIED_PER_LANGUAGE, wave: FIND_CONCURRENCY});

        found.forEach(feed => kept.add(nameOf(feed.site)));
        perInterest.push(found);
    }

    // the ones read through the bridge only while there is room for them, the next ones take their place
    const added = withinBridgeRoom(allocate(perInterest, perInterest.flat().length), bridgeRoom(feeds)).slice(0, room);
    await ProfileModel.addProfileFeeds(userId, added.map(({url, site, category, language}) => ({url, site, category, language})));
    return added;
};

const running = new Map();      // user -> discovery in progress

export const DiscoveryService = {
    // the sources of this profile found again, in background: only the status is awaited, not the
    // work. Asked again while it runs, it runs once more after, with the profile as it is then
    start: async (userId) => {
        await ProfileModel.setDiscovery(userId, 'running');
        const previous = running.get(userId) ?? Promise.resolve();
        const next = previous.then(async () => {
            await ProfileModel.setDiscovery(userId, 'running');
            try {
                const feeds = await discover(userId);
                console.log(`Discovery: ${feeds.length} feeds for user ${userId}`);
                // read and embedded now with the searches of Google News of the interests, so the next
                // briefing already has them
                const urls = [...feeds.map(feed => feed.url), ...await searchesOfUser(userId)];
                if (urls.length > 0) await IngestService.run({urls});
                await ProfileModel.setDiscovery(userId, 'done');
            } catch (err) {
                console.error(`Discovery failed for user ${userId}: ${err.stack ?? err}`);
                await ProfileModel.setDiscovery(userId, 'failed', err.message ?? String(err));
            }
        }).finally(() => {
            if (running.get(userId) === next) running.delete(userId);
        });
        running.set(userId, next);
    },

    isRunning: (userId) => running.has(userId),

    // the feeds found for the profile that bring nothing on it any more, removed (before each briefing)
    prune,
};
