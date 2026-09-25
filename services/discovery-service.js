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
import {IngestService} from "./ingest-service.js";
import {FeedbackService} from "./feedback-service.js";
import {search} from "./utils/google-news.js";
import {findFeeds, isOnSubject, subjectScore} from "./utils/feed-finder.js";
import {embed, denseSimilarity, parseVector} from "./utils/embedder.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {nameOf} from "./utils/public-url.js";
import {parseSearch} from "./utils/profile-ai.js";
import {allocate} from "./utils/allocation.js";

// Measured on four profiles: with the feeds of the project only, a private chef had 1 relevant
// story in 48 hours and a dog owner 2. The feeds found this way brought them to 8 and 32, and the
// choice of the section cut the chef's feeds from 167 news to 65 for the same relevant ones.
const SEARCH_DAYS = 7;              // a week of Google News says which media really write on it
const MEDIA_PER_INTEREST = 6;       // media tried per interest, each costs a few requests
const FIND_CONCURRENCY = 3;
// A news is on an interest when its cosine with the interest reaches this. Calibrated on the titles
// judged by hand: it keeps 57% of the fully relevant ones and 11% of the others, which is enough to
// tell a section from a general feed. Judging by keywords written by the AI changed from one run to
// the next; the meaning did not.
const JUDGE_THRESHOLD = 0.45;
// The feeds found for a profile have their own room, apart from the ones the user adds by hand: a
// user who had added 20 sources got none for their profile, silently.
const MAX_PROFILE_FEEDS = 20;

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

const discover = async (userId) => {
    const interests = await ProfileModel.interestsForDiscovery(userId);
    const own = await ProfileModel.ownFeedUrls(userId);

    // the feeds found before are about to be replaced: their media can be found again, except the
    // ones whose cards the reader refused again and again (see FeedbackService): not found twice
    const {refused} = await FeedbackService.of(userId);
    const known = await knownMedia(userId, {userFeeds: [...own, ...refused]});
    // A medium refused for one interest is tried again for the next: tribuna.com had 1 news in 30 on
    // the governance of the UEFA, was never judged on refereeing (7 in 30), and was lost. Only the
    // media already kept are not tried twice, their feed is already there
    const kept = new Set();
    const judge = judgeOf(interests.map(interest => parseVector(interest.dense)), new Map());
    const perInterest = [];

    for (const interest of interests) {
        const media = (await mediaOf(interest.searches))
            .filter(medium => !known.has(nameOf(medium.site)) && !kept.has(nameOf(medium.site)))
            .slice(0, MEDIA_PER_INTEREST);

        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        const found = await mapWithConcurrency(media, FIND_CONCURRENCY,
            medium => findFeeds(medium.site, {language: medium.lang, subject, judge}));

        perInterest.push(media.flatMap((medium, i) => {
            const feed = found[i].status === 'fulfilled' ? found[i].value[0] : null;
            if (!feed || !isOnSubject(feed)) return [];
            kept.add(nameOf(medium.site));
            return [{url: feed.url, site: medium.site, category: interest.category ?? 'world', language: medium.lang,
                score: subjectScore(feed)}];
        }));
    }

    const feeds = allocate(perInterest, MAX_PROFILE_FEEDS);
    await ProfileModel.replaceProfileFeeds(userId, feeds.map(({url, site, category, language}) => ({url, site, category, language})));
    return feeds;
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
                // read and embedded now, so the next briefing already has them
                if (feeds.length > 0) await IngestService.run({urls: feeds.map(feed => feed.url)});
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
};
