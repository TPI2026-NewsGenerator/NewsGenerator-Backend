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
import {knownFeeds, mediaCloudEnabled, mediaFor as pressMediaFor} from "./utils/media-cloud.js";
import {findFeeds, isOnSubject, subjectScore} from "./utils/feed-finder.js";
import {parseVector} from "./utils/embedder.js";
import {JUDGE_THRESHOLD, judgeOf} from "./utils/meaning-judge.js";
import {nameOf} from "./utils/public-url.js";
import {confirmOnSubject, parseSearch} from "./utils/profile-ai.js";
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
const CONFIRMED_TITLES = 12;        // news judged on the profile by the vectors the AI reads, the newest
// then the press Media Cloud names and Google News did not, with a budget of its own: measured
// (bench/mc-measure.mjs), 8 feeds on the subject of 11 media tried for the UEFA profile, but 2 of 20
// for the trading cards, where it only knows newspapers. It must not take the tries of Google News
const PRESS_KEPT_PER_LANGUAGE = 2;
const PRESS_TRIED_PER_LANGUAGE = 3;
// A news is on an interest when its cosine with the interest reaches JUDGE_THRESHOLD (see meaning-judge.js)
export {JUDGE_THRESHOLD};
// A feed found for the profile stays while its news are on the profile: on the UEFA profile goal.com
// had 18 such news in 14 days, the latimes.com none in 99. It is removed when none of its news of
// these days is, once it had the time or the news to show it
export const RELEVANCE_DAYS = 14;
const MIN_NEWS = 30;

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

// the media of the press Media Cloud names for the searches of an interest, the most present first.
// Its searches wait in their own queue (2 a minute): never an error, at worst none
const pressMediaOf = async (searches) => {
    const media = new Map();
    for (const {lang, q} of searches.map(parseSearch).filter(Boolean)) {
        for (const medium of await pressMediaFor(q, {language: lang})) {
            const key = nameOf(medium.site);
            const known = media.get(key) ?? {...medium, news: 0};
            known.news += medium.news;
            media.set(key, known);
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
    const [interests, feeds, profileCount] = await Promise.all([
        ProfileModel.interestsForDiscovery(userId),
        FeedModel.userFeedUrls(userId),
        FeedModel.countUserFeeds(userId, 'profile'),
    ]);
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
    // the judge of findFeeds: which texts are on one of the interests of the profile. A feed is kept
    // for the whole profile, and judged on one interest alone a football feed rarely had two news on
    // the governance of the UEFA among its last thirty: tribuna.com, kept one day, was lost the next
    const judge = judgeOf(interests.map(interest => parseVector(interest.dense)));
    const perInterest = [];

    const isNew = (medium) => !known.has(nameOf(medium.site)) && !kept.has(nameOf(medium.site));
    // The press of every interest asked at once: its searches wait for their turn (2 a minute) while
    // the media of Google News are tried. Asked interest after interest, the queue stood still during
    // the tries of each: 14 minutes for a reader of 3 interests, the queue alone needs 4 per interest
    const pressOf = interests.map(interest => mediaCloudEnabled() ? pressMediaOf(interest.searches) : Promise.resolve([]));
    for (const [index, interest] of interests.entries()) {
        const press = pressOf[index];
        const named = await mediaOf(interest.searches);

        const subject = [interest.keywords, ...interest.sections].filter(Boolean);
        // 'withKnown': the feeds the directory of Media Cloud knows for the medium are candidates too
        const tryMedium = (withKnown) => async (medium) => {
            const listed = withKnown ? await knownFeeds(medium.site) : [];
            const feed = await findFeeds(medium.site, {language: medium.lang, subject, judge, known: listed})
                .then(feeds => feeds[0], () => null);
            if (!feed || !isOnSubject(feed)) return null;
            // the AI reads the news the vectors put on the interests: chance ones are near the threshold
            // (see confirmOnSubject). The discovery never waits on it failing
            const titles = (feed.onSubjectTitles ?? []).slice(0, CONFIRMED_TITLES);
            const confirmed = await confirmOnSubject(interests.map(interest => interest.text), titles)
                .catch(err => {
                    console.error(`Discovery: the news of ${feed.url} were not read by the AI (${err.message})`);
                    return null;
                });
            if (confirmed && !isOnSubject({onSubject: confirmed.size})) {
                console.log(`Discovery: ${feed.url} left out, the AI found ${confirmed.size} of its ${titles.length} news on the profile`);
                return null;
            }
            // the language read in its news: tribuna.com/en/, found by a French search, is in English
            return {url: feed.url, site: medium.site, category: interest.category ?? 'world', language: feed.language ?? medium.lang,
                score: subjectScore(feed)};
        };
        const found = await tryPerLanguage(named.filter(isNew), tryMedium(false),
            {kept: KEPT_PER_LANGUAGE, tried: TRIED_PER_LANGUAGE, wave: FIND_CONCURRENCY});
        found.forEach(feed => kept.add(nameOf(feed.site)));

        const byGoogle = new Set(named.map(medium => nameOf(medium.site)));
        const pressOnly = (await press).filter(medium => isNew(medium) && !byGoogle.has(nameOf(medium.site)));
        const fromPress = await tryPerLanguage(pressOnly, tryMedium(true),
            {kept: PRESS_KEPT_PER_LANGUAGE, tried: PRESS_TRIED_PER_LANGUAGE, wave: FIND_CONCURRENCY});
        fromPress.forEach(feed => kept.add(nameOf(feed.site)));
        if (mediaCloudEnabled()) {
            console.log(`Discovery: user ${userId}, interest ${interest.position}: Media Cloud named ${pressOnly.length} new media, `
                + `kept ${fromPress.map(feed => feed.site).join(', ') || 'none'}`);
        }

        perInterest.push([...found, ...fromPress]);
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

    // A discovery lives in the memory of the server: a restart (a deploy) left it 'running' for good,
    // and the profile page waiting on it. Started again at the start of the server
    resumeInterrupted: async () => {
        const users = await ProfileModel.discovering();
        if (users.length > 0) console.log(`Discovery: started again for users ${users.join(', ')}, stopped by a restart`);
        for (const userId of users) await DiscoveryService.start(userId);
    },

    // the feeds found for the profile that bring nothing on it any more, removed (before each briefing)
    prune,
};
