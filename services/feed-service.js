//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-service.js
//  Description: Refresh of the RSS feeds cache, on demand when a search needs it
//

"use strict"

import process from 'node:process'
import {rss} from "../db/rss-links.js";
import {FeedModel} from "../models/feed-model.js";
import {Crawlers} from "./utils/crawlers.js";
import {toDate} from "./utils/dates.js";
import Links, {DEFAULT_LANGUAGE} from "./utils/links.js";

// the feeds are fetched when a search needs them, not in background: the cache is refreshed
// only if it is older than this
const MAX_AGE_MINUTES = Number(process.env.FEED_MAX_AGE_MINUTES) || 30;
const RETENTION_DAYS = Number(process.env.FEED_RETENTION_DAYS) || 30;

// refreshes in progress, by group of feeds ('feeds' and one per user), so the same feeds are never
// fetched twice at the same time. The feeds of a user are a group of their own: they are read when
// that user searches, not when somebody else does.
const running = new Map();

// the feeds shared by everybody, from db/rss-links.js, for one language only: a search in French
// has no reason to fetch the English sources, and the catalogue grows with every language added
const sharedUrls = (language) => [...new Set(Object.values(rss[language] ?? {}).flat())];

const doRefresh = async (urls, {purge = false} = {}) => {
    const start = Date.now();
    const feeds = await FeedModel.syncFeeds(urls);

    const results = await Crawlers.Xml(feeds.map(feed => ({
        url: feed.url,
        etag: feed.etag,
        lastModified: feed.last_modified,
    })));

    const now = new Date();
    const articles = [];
    let notModified = 0;
    let failed = 0;

    for (let i = 0; i < feeds.length; i++) {
        const feed = feeds[i];
        const result = results[i];

        if (result.error) {
            failed++;
            await FeedModel.updateFeed(feed.id, { last_fetched_at: now, last_error: result.error });
            continue;
        }
        if (result.notModified) notModified++;

        await FeedModel.updateFeed(feed.id, {
            etag: result.etag ?? feed.etag,
            last_modified: result.lastModified ?? feed.last_modified,
            last_fetched_at: now,
            last_error: null,
        });

        for (let news of result.items) {
            if (!news.link) continue;   // podcasts episodes without article page
            articles.push({
                id_feed: feed.id,
                link: news.link,
                title: news.title,
                description: news.description,
                thumbnail: news.thumbnail,
                category: news.category ?? [],
                published_at: toDate(news.pubDate),
            });
        }
    }

    const inserted = await FeedModel.insertArticles(articles);

    // the old articles are dropped once, with the shared feeds, not at every refresh of a user
    const deleted = purge
        ? await FeedModel.deleteArticlesOlderThan(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000))
        : 0;

    const stats = { feeds: feeds.length, notModified, failed, inserted, deleted, ms: Date.now() - start };
    console.log(`Feeds refreshed: ${JSON.stringify(stats)}`);
    return stats;
};

// fetch this group of feeds, or join the fetch already running for it
const refreshGroup = (key, urls, options) => {
    if (urls.length === 0) return null;

    if (!running.has(key)) {
        running.set(key, doRefresh(urls, options).finally(() => running.delete(key)));
    }
    return running.get(key);
};

// same thing, but only when one of these feeds has not been read for a while
const refreshStaleGroup = async (key, urls, options) => {
    if (urls.length === 0) return null;
    if (running.has(key)) return running.get(key);

    const oldest = await FeedModel.oldestFetch(urls);
    if (oldest && Date.now() - oldest.getTime() < MAX_AGE_MINUTES * 60 * 1000) return null;

    return refreshGroup(key, urls, options);
};

export const FeedService = {
    // fetch the shared feeds of a language and, when a user is given, their own sources
    refresh: async (userId = null, language = DEFAULT_LANGUAGE) => Promise.all([
        refreshGroup(`feeds:${language}`, sharedUrls(language), {purge: true}),
        userId ? refreshGroup(`user:${userId}`, await FeedModel.userFeedUrls(userId)) : null,
    ]),

    // refresh only what is too old, awaited by the searches of this user
    ensureFresh: async (userId = null, language = DEFAULT_LANGUAGE) => Promise.all([
        refreshStaleGroup(`feeds:${language}`, sharedUrls(language), {purge: true}),
        userId ? refreshStaleGroup(`user:${userId}`, await FeedModel.userFeedUrls(userId)) : null,
    ]),

    // languages that have sources, and the categories of one of them
    languages: () => Links.languages(),
    categories: (language = DEFAULT_LANGUAGE) => Links.categories(language),

    // keep the categories table in sync with the feeds list, for the custom searches
    syncCategories: () => FeedModel.syncCategories(
        [...new Set(Links.languages().flatMap(language => Links.categories(language)))]
    ),
}
