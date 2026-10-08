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
import {findFeeds, isOnSubject} from "./utils/feed-finder.js";
import {forClient, hostOf, isBridgeUrl, nameOf} from "./utils/public-url.js";
import {MAX_FEED_ITEMS} from "./utils/feed-limits.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {embed} from "./utils/embedder.js";
import {judgeOf} from "./utils/meaning-judge.js";

const MAX_CANDIDATES = 8;       // finding the feed of a site costs a few requests, so only the best are tried
const FIND_CONCURRENCY = 4;
const MAX_NEWS = 25;            // news shown for reading, the rest would only be noise
const MAX_DIRECTORY_RESULTS = 15;   // feeds answered to a search of the directory
const WEB_DAYS = 30;                // a subject the directory does not name: the media of its news of these days
const CHECK_CONCURRENCY = 6;        // sites of an imported list looked at together
const CHECK_TIMEOUT_MS = 60000;     // a site that keeps redirecting or answering slowly is given up
const MIN_RECENT = 3;               // news of the last 7 days: under this a feed is asleep

const withTimeout = (promise, ms) => {
    let timer;
    const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The site took too long to answer.')), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

// media already searched for this user: the feeds of db/rss-links.js and the ones they added.
// The address of a feed does not always name its medium ("feeds.content.dowjones.io" is the WSJ,
// feedburner is everybody), so the links of the articles already cached are read too.
// 'userFeeds' replaces the feeds of the user, when some of them are about to be replaced
export const knownMedia = async (profileId, {userFeeds = null} = {}) => {
    const urls = [
        ...Object.values(rss).flatMap(language => Object.values(language).flat()),
        ...(userFeeds ?? await FeedModel.userFeedUrls(profileId)),
    ];

    const hosts = [
        ...urls.map(hostOf).filter(Boolean),
        ...await FeedModel.articleHosts(urls),
    ];

    return new Set(hosts.map(nameOf));
};

// the feed of a source offered to the reader: a site read through our RSS-Bridge has no address for
// the client (feed null), the key names it to choose it; POST /feeds/import finds its feed again
const offered = (url) => {
    const {key, url: feed} = forClient(url);
    return {key, feed};
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

// Which news of a feed are on the search, by meaning, as the discovery judges the feeds of a profile.
// Judged by its words, and offered even with none on it, 45 feeds were offered on 9 searches
// (bench/web-quality.mjs) and about 7 were on them: the others were main feeds of newspapers (the one
// of midilibre.fr for the video refereeing of Ligue 1, its sample the weather). Judged by meaning and
// kept only on the search, 21, about 16 on it, and the section rather than the main feed (the Ligue 1
// feeds of midilibre.fr and ladepeche.fr); two searches get none rather than regional main feeds.
// Null without the embedder: findFeeds judges by the words
const meaningJudge = async (keywords) => {
    try {
        const [vector] = await embed([keywords.join(' ')]);
        return judgeOf([vector.dense]);
    } catch (err) {
        console.log(`Source search: the feeds are judged by their words (${err.message})`);
        return null;
    }
};

export const SourceService = {
    // feeds of the directory matching a site or the name of a feed ("premier league"), the most read
    // first, without the media this user already searches. They are checked before being added, not
    // here: the directory is only asked what exists.
    // The directory only reads the names of the feeds: a subject in several words ("tcg cartes
    // pokemon", "rugby top 14") names none. Asking it each word brought mostly noise ("magic the
    // gathering" gave 45 feeds named "magical"), so the media publishing on the whole words are asked
    // to Google News instead, by searchWeb: the client asks both at once and shows this answer first
    searchDirectory: async ({query, profileId}) => {
        const [found, known] = await Promise.all([
            directoryFeeds(query, 2 * MAX_DIRECTORY_RESULTS),
            knownMedia(profileId),
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
                ...offered(feed.url),
                language: feed.language,
                readers: feed.subscribers,
                via: 'directory',
            }));
    },

    // the media that published on these words in the last days, with the feed found for each and
    // how many news they published on them (20 to 45 s)
    searchWeb: async ({query, profileId, language = 'en'}) => {
        try {
            const found = await SourceService.suggest({
                keywords: [query], profileId, language,
                timeframe: {start: new Date(Date.now() - WEB_DAYS * 24 * 60 * 60 * 1000)},
            });
            return found.sources.map(({site, name, key, feed, news, sample}) => ({site, name, key, feed, language, news, sample, via: 'web'}));
        } catch (err) {
            // Google News refusing is no error here, the reader is only shown the directory
            console.log(`Source search, Google News: ${err.message}`);
            return [];
        }
    },

    // The sites of a list the reader imports (a file of theirs, read by the client), a few at a time:
    // the feed found for each, as the one added by hand would be, and what keeps it out. status:
    //  'ready'     a feed with news of these days
    //  'bridge'    no feed: read through our bridge, which counts in its own limit (see feed-limits.js)
    //  'asleep'    a feed, but fewer than MIN_RECENT news of the last days
    //  'flood'     a feed holding more than MAX_FEED_ITEMS news at once: told, the reader decides
    //  'added'     already among their sources
    //  'none'      no feed and no page to build one from
    // A list of 495 sites of a reader took about 4 minutes, 6 at a time
    checkSites: async ({sites, profileId, language = 'en'}) => {
        const added = new Set(await FeedModel.userFeedUrls(profileId));
        const results = await mapWithConcurrency(sites, CHECK_CONCURRENCY, async (site) => {
            let feeds;
            try {
                feeds = await withTimeout(findFeeds(site, {language}), CHECK_TIMEOUT_MS);
            } catch (err) {
                return {site, status: 'none', reason: err.message};
            }
            const feed = feeds.find(found => found.recent >= MIN_RECENT) ?? feeds[0];
            if (!feed) return {site, status: 'none', reason: 'No feed found, and no page to read instead.'};

            const bridge = isBridgeUrl(feed.url);
            const status = added.has(feed.url) ? 'added'
                : feed.items > MAX_FEED_ITEMS ? 'flood'
                : feed.recent < MIN_RECENT ? 'asleep'
                : bridge ? 'bridge' : 'ready';
            return {
                site, status,
                name: hostOf(site) ?? site,
                ...offered(feed.url),
                language: feed.language ?? null,
                recent: feed.recent ?? null,
                items: feed.items ?? null,
                sample: feed.titles?.[0] ?? null,
            };
        });
        return results.map((result, i) => result.value ?? {site: sites[i], status: 'none', reason: String(result.reason?.message ?? result.reason)});
    },

    // what this search misses. Google News is asked the same keywords in one call: the news of the
    // media that are not in the sources (read only, their link goes through a Google redirect so the
    // server can neither scrape nor summarize them) and those media, with the feed to add for each
    suggest: async ({keywords, timeframe = {}, profileId, language = 'en'}) => {
        const days = timeframe.start
            ? Math.ceil((Date.now() - new Date(timeframe.start).getTime()) / (24 * 60 * 60 * 1000))
            : null;

        // the two directories are asked at the same time, and GDELT answering nothing costs nothing:
        // it names media Google News does not, but it is slow and refuses requests under load
        const [{news, media}, alsoFound, known, judge] = await Promise.all([
            search(keywords, {days: days > 0 ? days : null, language}),
            gdeltMedia(keywords, {days: days > 0 ? days : 2, language}),
            knownMedia(profileId),
            meaningJudge(keywords),
        ]);
        const isMissing = (site) => !known.has(nameOf(site));

        // The media are counted on all the news of Google. Sorted by the AI first (bench/web-quality.mjs,
        // 9 searches), the media of its answers alone gave 10 feeds on the subject instead of 21: a
        // sentence has few answers, and on words ("trading card games") it left the Pokémon TCG out;
        // it kept the rugby as close to "l'arbitrage vidéo en Ligue 1" all the same
        const missing = mergeMedia(media, alsoFound).filter(medium => isMissing(medium.site));
        const candidates = missing.slice(0, MAX_CANDIDATES);

        // the news the search could not find: those of the media that are not searched
        const missingNews = news
            .filter(item => isMissing(item.site))
            .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
            .slice(0, MAX_NEWS);

        // the feed kept for a medium is its section on these keywords, not its main feed where they
        // are 3 news out of 100, and a medium with none on them is not offered
        const feeds = await mapWithConcurrency(candidates, FIND_CONCURRENCY,
            medium => findFeeds(medium.site, {language, subject: keywords, ...(judge ? {judge} : {})}));

        const sources = candidates
            .map((medium, i) => ({
                ...medium,
                feed: feeds[i].status === 'fulfilled' ? feeds[i].value[0] : null,
            }))
            .filter(medium => medium.feed && isOnSubject(medium.feed))
            .map(({site, name, news, feed}) => ({
                site: site,
                name: name,
                news: news,             // how many news this medium published on the subject
                ...offered(feed.url),
                sample: feed.titles?.[0] ?? null,
            }));

        // 'missing' can be larger than 'sources': the media without a feed, and the ones not tried
        return {news: missingNews, sources, missing: missing.length, tried: candidates.length};
    },
}
