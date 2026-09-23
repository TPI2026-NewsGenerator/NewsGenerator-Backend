//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: source-service.js
//  Description: What a search misses: the news published by the media that are not in the sources
//               of the user, and those media with the feed to add for each
//

"use strict"

import {rss} from "../db/rss-links.js";
import {FeedModel} from "../models/feed-model.js";
import {search} from "./utils/google-news.js";
import {findFeeds} from "./utils/feed-finder.js";
import {hostOf, nameOf} from "./utils/public-url.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

const MAX_CANDIDATES = 8;       // finding the feed of a site costs a few requests, so only the best are tried
const FIND_CONCURRENCY = 4;
const MAX_NEWS = 25;            // news shown for reading, the rest would only be noise

// media already searched for this user: the feeds of db/rss-links.js and the ones they added.
// The address of a feed does not always name its medium ("feeds.content.dowjones.io" is the WSJ,
// feedburner is everybody), so the links of the articles already cached are read too
const knownMedia = async (userId) => {
    const urls = [
        ...Object.values(rss).flatMap(language => Object.values(language).flat()),
        ...await FeedModel.userFeedUrls(userId),
    ];

    const hosts = [
        ...urls.map(hostOf).filter(Boolean),
        ...await FeedModel.articleHosts(urls),
    ];

    return new Set(hosts.map(nameOf));
};

export const SourceService = {
    // what this search misses. Google News is asked the same keywords in one call: the news of the
    // media that are not in the sources (read only, their link goes through a Google redirect so the
    // server can neither scrape nor summarize them) and those media, with the feed to add for each
    suggest: async ({keywords, timeframe = {}, userId}) => {
        const days = timeframe.start
            ? Math.ceil((Date.now() - new Date(timeframe.start).getTime()) / (24 * 60 * 60 * 1000))
            : null;

        const {news, media} = await search(keywords, {days: days > 0 ? days : null});

        const known = await knownMedia(userId);
        const isMissing = (site) => !known.has(nameOf(site));

        const missing = media.filter(medium => isMissing(medium.site));
        const candidates = missing.slice(0, MAX_CANDIDATES);

        // the news the search could not find: those of the media that are not searched
        const missingNews = news
            .filter(item => isMissing(item.site))
            .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
            .slice(0, MAX_NEWS);

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
        return {news: missingNews, sources, missing: missing.length, tried: candidates.length};
    },
}
