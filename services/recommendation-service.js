//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: recommendation-service.js
//  Description: The sources a reader could add, among the feeds the server already reads for the
//               others: the ones found for their profiles and the ones they shared, never one another
//               reader only added by hand
//

"use strict"

import {rss} from "../db/rss-links.js";
import {FeedModel} from "../models/feed-model.js";
import {ProfileModel} from "../models/profile-model.js";
import {FeedbackService, siteOf} from "./feedback-service.js";
import {CONFIRMED_TITLES, JUDGE_THRESHOLD} from "./discovery-service.js";
import {knownMedia} from "./source-service.js";
import {bridgeRoom, looksPrivate, MAX_USER_FEEDS} from "./utils/feed-limits.js";
import {isBridgeUrl, nameOf} from "./utils/public-url.js";
import {confirmOnSubject} from "./utils/profile-ai.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

// A week of news says what a feed publishes; a feed with 3 news on the interests of the reader in it
// brings them something the feeds they have missed. But a title reaches the threshold by chance now
// and then, and a feed of 300 to 500 news a week always had 3 of them: a TCG profile was offered a
// Paris outings feed (a casino) and a tennis one, 1.2% and 0.6% of their news. Measured on the 4
// profiles (bench/recommend-scores.mjs), the wrong ones were all under 1.5% of their news, the right
// ones at 2.5% and more: those 3 news must also be 2% of the feed
const RECENT_DAYS = 7;
const MIN_RELEVANT = 3;
const MIN_RELEVANT_SHARE = 0.02;
const MAX_RECOMMENDED = 20;
const MAX_ADDED_PER_CALL = MAX_RECOMMENDED;

// The title of a news reaches the threshold of an interest through its words as well as its subject:
// "Economics of refereeing: finances, partnerships and sponsors" put on Enzo's interests a tennis
// feed (a players' lawsuit, prize money, 0.47 to 0.51) and a law firm feed (compliance, government
// contractors, 0.45 to 0.47). As the discovery does (see confirmOnSubject), the AI reads the titles
// the vectors put on the interests, and a feed is recommended on the ones it confirms. Its answer is
// kept a day per profile and feed, the interests unchanged: the list is asked at each visit of the page
const CONFIRM_KEPT_MS = 24 * 3600e3;
const CONFIRM_CONCURRENCY = 4;
const CONFIRMS_REMEMBERED = 5000;
const confirmations = new Map();        // `${profileId}:${feedId}` -> {interests, at, verdict}

// {titles, judged}: the titles of the feed the AI confirmed on the interests, of the ones it read.
// null when it did not answer: the feed is judged on the vectors alone, and the AI asked next time
const confirmed = (profileId, interests, row) => {
    const id = `${profileId}:${row.id}`;
    const said = interests.join('\n');
    const known = confirmations.get(id);
    if (known && known.interests === said && Date.now() - known.at < CONFIRM_KEPT_MS) return known.verdict;

    const titles = (row.titles ?? []).slice(0, CONFIRMED_TITLES);
    const verdict = confirmOnSubject(interests, titles)
        .then(onSubject => onSubject && {titles: titles.filter((_, index) => onSubject.has(index)), judged: titles.length})
        .catch(err => {
            console.error(`Recommendations: the news of ${row.url} were not read by the AI (${err.message})`);
            return null;
        })
        .then(verdict => {
            if (verdict === null) confirmations.delete(id);
            return verdict;
        });

    if (confirmations.size >= CONFIRMS_REMEMBERED) {
        for (const [key, entry] of confirmations) {
            if (Date.now() - entry.at >= CONFIRM_KEPT_MS) confirmations.delete(key);
        }
    }
    confirmations.set(id, {interests: said, at: Date.now(), verdict});
    return verdict;
};

// the feed as the AI read it: as many news on the interests as the share of its titles it confirmed,
// and those titles shown. null when too few of them are left
export const afterConfirmation = (row, verdict) => {
    if (verdict === null) return row;
    const relevant = verdict.judged === 0 ? 0 : Math.round(row.relevant * verdict.titles.length / verdict.judged);
    if (relevant < MIN_RELEVANT || relevant < MIN_RELEVANT_SHARE * row.news) return null;
    return {...row, relevant, samples: verdict.titles.slice(0, 2)};
};

// Only feeds read for another reader for a public reason are candidates (see recommendedFeeds): a
// source a reader added by hand says what they follow, and its address may hold their key. Then the
// media this reader already reads are left out, even through another feed: a second section of
// goal.com is not a new source
const recommended = async (profileId) => {
    const profile = await ProfileModel.get(profileId);
    if (!profile) return [];

    const shared = Object.values(rss).flatMap(language => Object.values(language).flat());
    // the sources found for the profile the reader removed are not suggested back to them
    const [{refused}, removed, own, interests] = await Promise.all([FeedbackService.of(profileId),
        ProfileModel.removedSources(profileId).then(sources => sources.map(source => source.url)), FeedModel.userFeedUrls(profileId),
        ProfileModel.interests(profileId).then(interests => interests.map(interest => interest.text))]);
    const known = await knownMedia(profileId, {userFeeds: [...own, ...removed]});
    const rows = await FeedModel.recommendedFeeds(profileId, {
        excluded: [...shared, ...refused, ...removed],
        languages: null,                // the reader reads every language
        since: new Date(Date.now() - RECENT_DAYS * 24 * 3600e3),
        threshold: JUDGE_THRESHOLD,
        minRelevant: MIN_RELEVANT,
        minShare: MIN_RELEVANT_SHARE,
        // some are left out below
        limit: 3 * MAX_RECOMMENDED,
        maxTitles: CONFIRMED_TITLES,
    });
    const candidates = rows.filter(row => !looksPrivate(row.url) && !known.has(nameOf(siteOf(row.url))));

    // read by the AI a few at a time, the most relevant first, until there are enough
    const kept = [];
    for (let start = 0; start < candidates.length && kept.length < MAX_RECOMMENDED; start += CONFIRM_CONCURRENCY) {
        const wave = candidates.slice(start, start + CONFIRM_CONCURRENCY);
        const verdicts = await mapWithConcurrency(wave, CONFIRM_CONCURRENCY, row => confirmed(profileId, interests, row));
        wave.forEach((row, index) => {
            const left = afterConfirmation(row, verdicts[index].value ?? null);
            if (left) kept.push(left);
        });
    }
    return kept.sort((a, b) => b.relevant - a.relevant || a.news - b.news).slice(0, MAX_RECOMMENDED);
};

// what the reader sees of a feed: the address of our RSS-Bridge is only ours
const toRecommendation = (row) => ({
    id: row.id,                     // of the feed, the one to send back to add it
    site: siteOf(row.url),
    url: isBridgeUrl(row.url) ? null : row.url,
    category: row.category,
    language: row.language,
    news: row.news,                 // its news of the last days
    relevant: row.relevant,         // how many of them are on the interests of the reader
    samples: row.samples,           // the titles closest to them
});

export const RecommendationService = {
    // [{id, site, url, category, language, news, relevant, samples}], the most relevant first
    list: async (profileId) => (await recommended(profileId)).map(toRecommendation),

    // the feeds chosen among the recommended ones, added as if by hand: never removed without the
    // reader. Only ids are sent: every address added is one this server already reads, the client
    // never names one (a feed of our RSS-Bridge included)
    add: async (userId, profileId, ids) => {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ADDED_PER_CALL || !ids.every(Number.isInteger)) {
            throw Object.assign(new Error(`ids: 1 to ${MAX_ADDED_PER_CALL} ids of recommended sources.`), {status: 400});
        }

        const offered = new Map((await recommended(profileId)).map(row => [row.id, row]));
        const [count, urls] = await Promise.all([FeedModel.countUserFeeds(profileId), FeedModel.userFeedUrls(profileId)]);
        let room = MAX_USER_FEEDS - count;
        let bridge = bridgeRoom(urls);
        const added = [];
        const errors = [];

        for (const id of new Set(ids)) {
            const row = offered.get(id);
            if (!row) {
                errors.push({id, error: 'This source is not recommended to you any more.'});
            } else if (room <= 0) {
                errors.push({id, site: siteOf(row.url), error: `You can't have more than ${MAX_USER_FEEDS} sources.`});
            } else if (isBridgeUrl(row.url) && bridge <= 0) {
                errors.push({id, site: siteOf(row.url), error: 'You have as many sites without a feed as the server can read for you.'});
            } else {
                try {
                    added.push(await FeedModel.addUserFeed({
                        userId, profileId, url: row.url, site: siteOf(row.url), category: row.category, language: row.language,
                    }));
                    room--;
                    if (isBridgeUrl(row.url)) bridge--;
                } catch (error) {
                    errors.push({id, site: siteOf(row.url), error: error.code === 'P2002' ? 'You already added this source.' : error.message});
                }
            }
        }

        return {feeds: added, errors};
    },
};
