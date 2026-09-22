//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: source-service.js
//  Description: Suggests the media covering a search that are missing from the sources of the user
//

"use strict"

import {rss} from "../db/rss-links.js";
import {FeedModel} from "../models/feed-model.js";
import {mediaFor} from "./utils/google-news.js";
import {findFeeds} from "./utils/feed-finder.js";
import {hostOf, mediumOf} from "./utils/public-url.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

const MAX_CANDIDATES = 8;       // finding the feed of a site costs a few requests, so only the best are tried
const FIND_CONCURRENCY = 4;

// media already searched for this user: the feeds of db/rss-links.js and the ones they added
const knownMedia = async (userId) => {
    const urls = [
        ...Object.values(rss).flatMap(language => Object.values(language).flat()),
        ...await FeedModel.userFeedUrls(userId),
    ];

    return new Set(urls.map(hostOf).filter(Boolean).map(mediumOf));
};

export const SourceService = {
    // media publishing on this search but missing from the sources, with the feed to add for each
    // the search itself is not redone: Google News is asked the same keywords, only to name the media
    suggest: async ({keywords, timeframe = {}, userId}) => {
        const days = timeframe.start
            ? Math.ceil((Date.now() - new Date(timeframe.start).getTime()) / (24 * 60 * 60 * 1000))
            : null;

        const media = await mediaFor(keywords, {days: days > 0 ? days : null});

        const known = await knownMedia(userId);
        const missing = media.filter(medium => !known.has(mediumOf(medium.site)));
        const candidates = missing.slice(0, MAX_CANDIDATES);

        const found = await mapWithConcurrency(candidates, FIND_CONCURRENCY, medium => findFeeds(medium.site));

        const sources = candidates
            .map((medium, i) => ({
                ...medium,
                feed: found[i].status === 'fulfilled' ? found[i].value[0] : null,
            }))
            .filter(medium => medium.feed)
            .map(({site, name, news, feed}) => ({
                site: site,
                name: name,
                news: news,             // how many news this medium published on the subject
                feed: feed.url,
                sample: feed.titles?.[0] ?? null,
            }));

        // 'missing' can be larger than 'sources': the media without a feed, and the ones not tried
        return {sources, missing: missing.length, tried: candidates.length};
    },
}
