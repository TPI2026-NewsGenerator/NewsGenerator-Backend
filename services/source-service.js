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
import {searchDirectory as directoryFeeds} from "./utils/feed-directory.js";
import {mediaFor as gdeltMedia} from "./utils/gdelt.js";
import {findFeeds} from "./utils/feed-finder.js";
import {hostOf, nameOf} from "./utils/public-url.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

const MAX_CANDIDATES = 8;       // finding the feed of a site costs a few requests, so only the best are tried
const FIND_CONCURRENCY = 4;
const MAX_NEWS = 25;            // news shown for reading, the rest would only be noise
const MAX_DIRECTORY_RESULTS = 15;   // feeds answered to a search of the directory
const WEB_DAYS = 30;                // a subject the directory does not name: the media of its news of these days

// media already searched for this user: the feeds of db/rss-links.js and the ones they added.
// The address of a feed does not always name its medium ("feeds.content.dowjones.io" is the WSJ,
// feedburner is everybody), so the links of the articles already cached are read too.
// 'userFeeds' replaces the feeds of the user, when some of them are about to be replaced
export const knownMedia = async (userId, {userFeeds = null} = {}) => {
    const urls = [
        ...Object.values(rss).flatMap(language => Object.values(language).flat()),
        ...(userFeeds ?? await FeedModel.userFeedUrls(userId)),
    ];

    const hosts = [
        ...urls.map(hostOf).filter(Boolean),
        ...await FeedModel.articleHosts(urls),
    ];

    return new Set(hosts.map(nameOf));
};

// the media of the two directories in one list: a medium both of them name counts for both, and
// the ones publishing the most on the subject come first
const mergeMedia = (...lists) => {
    const media = new Map();

    for (const medium of lists.flat()) {
        const name = nameOf(medium.site);
        const found = media.get(name);

        if (found) found.news += medium.news;
        else media.set(name, {...medium});
    }

    return [...media.values()].sort((a, b) => b.news - a.news);
};

export const SourceService = {
    // feeds of the directory matching a site or the name of a feed ("premier league"), the most read
    // first, without the media this user already searches. They are checked before being added, not
    // here: the directory is only asked what exists.
    // The directory only reads the names of the feeds: a subject in several words ("tcg cartes
    // pokemon", "rugby top 14") names none. Asking it each word brought mostly noise ("magic the
    // gathering" gave 45 feeds named "magical"), so the media publishing on the whole words are asked
    // to Google News instead, by searchWeb: the client asks both at once and shows this answer first
    searchDirectory: async ({query, userId}) => {
        const [found, known] = await Promise.all([
            directoryFeeds(query, 2 * MAX_DIRECTORY_RESULTS),
            knownMedia(userId),
        ]);

        // the feed and the site it belongs to are both compared: the Guardian publishes on
        // theguardian.com but serves its feeds from guardian.co.uk, either name is enough to know it
        const isKnown = (feed) => [feed.url, feed.site]
            .map(hostOf)
            .filter(Boolean)
            .some(host => known.has(nameOf(host)));

        return found
            .filter(feed => !isKnown(feed))
            .slice(0, MAX_DIRECTORY_RESULTS)
            .map(feed => ({
                site: hostOf(feed.site) ?? hostOf(feed.url),
                name: feed.title || hostOf(feed.url),
                feed: feed.url,
                language: feed.language,
                readers: feed.subscribers,
                via: 'directory',
            }));
    },

    // the media that published on these words in the last days, with the feed found for each and
    // how many news they published on them (20 to 45 s)
    searchWeb: async ({query, userId, language = 'en'}) => {
        try {
            const found = await SourceService.suggest({
                keywords: [query], userId, language,
                timeframe: {start: new Date(Date.now() - WEB_DAYS * 24 * 60 * 60 * 1000)},
            });
            return found.sources.map(({site, name, feed, news, sample}) => ({site, name, feed, language, news, sample, via: 'web'}));
        } catch (err) {
            // Google News refusing is no error here, the reader is only shown the directory
            console.log(`Source search, Google News: ${err.message}`);
            return [];
        }
    },

    // what this search misses. Google News is asked the same keywords in one call: the news of the
    // media that are not in the sources (read only, their link goes through a Google redirect so the
    // server can neither scrape nor summarize them) and those media, with the feed to add for each
    suggest: async ({keywords, timeframe = {}, userId, language = 'en'}) => {
        const days = timeframe.start
            ? Math.ceil((Date.now() - new Date(timeframe.start).getTime()) / (24 * 60 * 60 * 1000))
            : null;

        // the two directories are asked at the same time, and GDELT answering nothing costs nothing:
        // it names media Google News does not, but it is slow and refuses requests under load
        const [{news, media}, alsoFound] = await Promise.all([
            search(keywords, {days: days > 0 ? days : null, language}),
            gdeltMedia(keywords, {days: days > 0 ? days : 2, language}),
        ]);

        const known = await knownMedia(userId);
        const isMissing = (site) => !known.has(nameOf(site));

        const missing = mergeMedia(media, alsoFound).filter(medium => isMissing(medium.site));
        const candidates = missing.slice(0, MAX_CANDIDATES);

        // the news the search could not find: those of the media that are not searched
        const missingNews = news
            .filter(item => isMissing(item.site))
            .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
            .slice(0, MAX_NEWS);

        // the feed kept for a medium is its section on these keywords, not its main feed where they
        // are 3 news out of 100
        const found = await mapWithConcurrency(candidates, FIND_CONCURRENCY, medium => findFeeds(medium.site, {language, subject: keywords}));

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
