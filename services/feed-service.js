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

// the feeds are fetched when a search needs them, not in background: the cache is refreshed
// only if it is older than this
const MAX_AGE_MINUTES = Number(process.env.FEED_MAX_AGE_MINUTES) || 30;
const RETENTION_DAYS = Number(process.env.FEED_RETENTION_DAYS) || 30;

let running = null;     // refresh in progress, shared so two refreshes never run at the same time

// every feed url of every language and category, without duplicates
const allFeedUrls = () => [...new Set(
    Object.values(rss).flatMap(language => Object.values(language).flat())
)];

const toDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !isNaN(date) ? date : null;
};

const doRefresh = async () => {
    const start = Date.now();
    const feeds = await FeedModel.syncFeeds(allFeedUrls());

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
    const deleted = await FeedModel.deleteArticlesOlderThan(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));

    const stats = { feeds: feeds.length, notModified, failed, inserted, deleted, ms: Date.now() - start };
    console.log(`Feeds refreshed: ${JSON.stringify(stats)}`);
    return stats;
};

export const FeedService = {
    // fetch every feed and save the new articles, one refresh at a time
    refresh: () => {
        if (!running) {
            running = doRefresh().finally(() => running = null);
        }
        return running;
    },

    // refresh only if the cache is too old, awaited by the searches
    ensureFresh: async () => {
        if (running) return running;

        const lastFetchedAt = await FeedModel.lastFetchedAt();
        const age = lastFetchedAt ? Date.now() - lastFetchedAt.getTime() : Infinity;
        if (age < MAX_AGE_MINUTES * 60 * 1000) return null;

        return FeedService.refresh();
    },

    // categories of the feeds, they can be used in a search
    categories: () => [...new Set(Object.values(rss).flatMap(language => Object.keys(language)))],

    // keep the categories table in sync with the feeds list, for the custom searches
    syncCategories: () => FeedModel.syncCategories(FeedService.categories()),
}
