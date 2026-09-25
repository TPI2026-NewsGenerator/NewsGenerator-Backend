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
import {JUDGE_THRESHOLD} from "./discovery-service.js";
import {knownMedia} from "./source-service.js";
import {bridgeRoom, looksPrivate, MAX_USER_FEEDS} from "./utils/feed-limits.js";
import {isBridgeUrl, nameOf} from "./utils/public-url.js";

// A week of news says what a feed publishes; a feed with 3 news on the interests of the reader in it
// brings them something the feeds they have missed
const RECENT_DAYS = 7;
const MIN_RELEVANT = 3;
const MAX_RECOMMENDED = 20;
const MAX_ADDED_PER_CALL = MAX_RECOMMENDED;

// Only feeds read for another reader for a public reason are candidates (see recommendedFeeds): a
// source a reader added by hand says what they follow, and its address may hold their key. Then the
// media this reader already reads are left out, even through another feed: a second section of
// goal.com is not a new source
const recommended = async (userId) => {
    const profile = await ProfileModel.get(userId);
    if (!profile) return [];

    const shared = Object.values(rss).flatMap(language => Object.values(language).flat());
    const [{refused}, known] = await Promise.all([FeedbackService.of(userId), knownMedia(userId)]);
    const rows = await FeedModel.recommendedFeeds(userId, {
        excluded: [...shared, ...refused],
        languages: profile.languages,
        since: new Date(Date.now() - RECENT_DAYS * 24 * 3600e3),
        threshold: JUDGE_THRESHOLD,
        minRelevant: MIN_RELEVANT,
        // some are left out below
        limit: 3 * MAX_RECOMMENDED,
    });

    return rows
        .filter(row => !looksPrivate(row.url) && !known.has(nameOf(siteOf(row.url))))
        .slice(0, MAX_RECOMMENDED);
};

// what the reader sees of a feed: the address of our RSS-Bridge is only ours
const toRecommendation = (row) => ({
    id: row.id,                     // of the feed, the one to send back to add it
    site: siteOf(row.url),
    url: isBridgeUrl(row.url) ? null : row.url,
    category: row.category,
    language: row.language,
    news: row.news,                 // its news of the last days in the languages of the reader
    relevant: row.relevant,         // how many of them are on the interests of the reader
    samples: row.samples,           // the titles closest to them
});

export const RecommendationService = {
    // [{id, site, url, category, language, news, relevant, samples}], the most relevant first
    list: async (userId) => (await recommended(userId)).map(toRecommendation),

    // the feeds chosen among the recommended ones, added as if by hand: never removed without the
    // reader. Only ids are sent: every address added is one this server already reads, the client
    // never names one (a feed of our RSS-Bridge included)
    add: async (userId, ids) => {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ADDED_PER_CALL || !ids.every(Number.isInteger)) {
            throw Object.assign(new Error(`ids: 1 to ${MAX_ADDED_PER_CALL} ids of recommended sources.`), {status: 400});
        }

        const offered = new Map((await recommended(userId)).map(row => [row.id, row]));
        const [count, urls] = await Promise.all([FeedModel.countUserFeeds(userId), FeedModel.userFeedUrls(userId)]);
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
                        userId, url: row.url, site: siteOf(row.url), category: row.category, language: row.language,
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
