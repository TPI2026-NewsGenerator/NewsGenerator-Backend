//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-service.js
//  Description: Refresh of the RSS feeds cache, in background (see ingest-service.js)
//

"use strict"

import process from 'node:process'
import {FeedModel} from "../models/feed-model.js";
import {Crawlers} from "./utils/crawlers.js";
import {toDate} from "./utils/dates.js";
import Links, {DEFAULT_LANGUAGE} from "./utils/links.js";
import {isGoogleNewsUrl, readSearches} from "./utils/google-news.js";

export const RETENTION_DAYS = Number(process.env.FEED_RETENTION_DAYS) || 30;

// refreshes in progress, by group of feeds, so the same feeds are never fetched twice at the same time
const running = new Map();

const doRefresh = async (urls, {purge = false} = {}) => {
    const start = Date.now();
    const feeds = await FeedModel.syncFeeds(urls);

    // the searches of Google News one after the other, in the queue of every request to Google;
    // the other feeds all at once
    const google = feeds.filter(feed => isGoogleNewsUrl(feed.url));
    const others = feeds.filter(feed => !isGoogleNewsUrl(feed.url));
    const [read, searched] = await Promise.all([
        Crawlers.Xml(others.map(feed => ({
            url: feed.url,
            etag: feed.etag,
            lastModified: feed.last_modified,
        }))),
        readSearches(google.map(feed => feed.url)),
    ]);
    const byUrl = new Map([...read, ...searched].map(result => [result.url, result]));
    const results = feeds.map(feed => byUrl.get(feed.url));

    const now = new Date();
    const articles = [];
    let notModified = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < feeds.length; i++) {
        const feed = feeds[i];
        const result = results[i];

        // Google paused the searches: read at the next refresh, as if never asked
        if (result.skipped) {
            skipped++;
            continue;
        }
        if (result.error) {
            failed++;
            await FeedModel.updateFeed(feed.id, { last_fetched_at: now, last_error: result.error, failures: { increment: 1 } });
            continue;
        }
        if (result.notModified) notModified++;

        await FeedModel.updateFeed(feed.id, {
            etag: result.etag ?? feed.etag,
            last_modified: result.lastModified ?? feed.last_modified,
            last_fetched_at: now,
            last_error: null,
            failures: 0,
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
                // the publisher Google News gives: its links are its own redirects
                source_url: isGoogleNewsUrl(feed.url) ? news.source?.url ?? null : null,
            });
        }
    }

    // a news its feed gave already under another link is not saved again (see withoutRepeats)
    const inserted = await FeedModel.insertArticles(await FeedModel.withoutRepeats(articles));

    // the old articles are dropped once, with the shared feeds, not at every refresh of a user
    const deleted = purge
        ? await FeedModel.deleteArticlesOlderThan(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000))
        : 0;

    const stats = { feeds: feeds.length, notModified, failed, skipped, inserted, deleted, ms: Date.now() - start };
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

export const FeedService = {
    // fetch these feeds now, the old news dropped when 'purge' (see IngestService.run)
    refreshUrls: (urls, {purge = false} = {}) => refreshGroup(purge ? 'all' : `urls:${urls.join('|')}`, urls, {purge}),

    // languages that have sources, and the categories of one of them
    languages: () => Links.languages(),
    categories: (language = DEFAULT_LANGUAGE) => Links.categories(language),

    // keep the categories table in sync with the feeds list, for the custom searches
    syncCategories: () => FeedModel.syncCategories(
        [...new Set(Links.languages().flatMap(language => Links.categories(language)))]
    ),
}
