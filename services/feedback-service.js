//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: feedback-service.js
//  Description: The thumbs of the reader on the cards of the last days, for the briefing and for the
//               discovery of the sources (see utils/feedback.js)
//

"use strict"

import {rss} from "../db/rss-links.js";
import {BriefingModel} from "../models/briefing-model.js";
import {ProfileModel} from "../models/profile-model.js";
import {FeedModel} from "../models/feed-model.js";
import {examplesOf, refusedCounts} from "./utils/feedback.js";
import {hostOf, isBridgeUrl, sourceKey} from "./utils/public-url.js";

const FEEDBACK_DAYS = 30;       // an older thumb says less of what the reader wants now

const recentVotes = (userId) => BriefingModel.votes(userId, new Date(Date.now() - FEEDBACK_DAYS * 24 * 3600e3));

// the medium of a feed, as the reader knows it: a feed built by our RSS-Bridge names it in home_page
export const siteOf = (url) => {
    if (isBridgeUrl(url)) {
        try {
            return hostOf(new URL(url).searchParams.get('home_page') ?? '') ?? url;
        } catch {
            return url;
        }
    }
    return hostOf(url) ?? url;
};

// the votes and the feeds no vote can leave out: the shared ones, the ones added by hand, the kept
// ones and the trusted ones
const read = async (userId) => {
    const [votes, own, kept, trusted] = await Promise.all([recentVotes(userId), ProfileModel.ownFeedUrls(userId),
        ProfileModel.keptSources(userId), FeedModel.trustedFeedUrls(userId)]);
    const shared = Object.values(rss).flatMap(language => Object.values(language).flat());
    return {votes, kept: [...shared, ...own, ...kept, ...trusted]};
};

export const FeedbackService = {
    // {liked: [titles], refused: [titles]} for the AI that chooses, and the feeds to leave out
    of: async (userId) => {
        const {votes, kept} = await read(userId);
        return {examples: examplesOf(votes), refused: refusedCounts(votes, kept).map(({url}) => url)};
    },

    // the sources left out, for the reader: [{url, site, refused, liked}]
    refusedSources: async (userId) => {
        const {votes, kept} = await read(userId);
        return refusedCounts(votes, kept).map(source => ({...source, site: siteOf(source.url)}));
    },

    // the reader keeps a source their thumbs left out, by its key (see forClient): only one of them, it
    // is never left out again
    keep: async (userId, key) => {
        const source = (await FeedbackService.refusedSources(userId)).find(refused => sourceKey(refused.url) === key);
        if (!source) {
            throw Object.assign(new Error('This source is not left out.'), {status: 404});
        }
        await ProfileModel.keepSource(userId, source.url);
    },
};
