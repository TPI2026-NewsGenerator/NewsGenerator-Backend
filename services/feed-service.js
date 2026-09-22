//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-service.js
//  Description: Background refresh of the RSS feeds cache
//

"use strict"

import process from 'node:process'
import {rss} from "../db/rss-links.js";
import {FeedModel} from "../models/feed-model.js";
import {Crawlers} from "./utils/crawlers.js";
import {ollamaClassify} from "./utils/ollama.js";
import {mapWithConcurrency} from "./utils/concurrency.js";

const REFRESH_MINUTES = Number(process.env.FEED_REFRESH_MINUTES) || 15;
const RETENTION_DAYS = Number(process.env.FEED_RETENTION_DAYS) || 7;
const CLASSIFY_MAX = Number(process.env.FEED_CLASSIFY_MAX) || 400;   // articles classified per run, limits the AI cost
const CLASSIFY_BATCH = 40;          // articles sent to the AI in one call
const CLASSIFY_CONCURRENCY = 3;     // AI calls at the same time

let running = null;     // refresh in progress, shared so two refreshes never run at the same time
let classifying = null; // classification in progress
let firstRun = null;    // first refresh, awaited by the requests arriving before the cache is filled
let timer = null;

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

// give a topic to the articles saved without one, by batches
const doClassify = async () => {
    const start = Date.now();
    const articles = await FeedModel.getUnclassifiedArticles(CLASSIFY_MAX);

    const batches = [];
    for (let i = 0; i < articles.length; i += CLASSIFY_BATCH) {
        batches.push(articles.slice(i, i + CLASSIFY_BATCH));
    }

    let classified = 0;
    let failed = 0;
    await mapWithConcurrency(batches, CLASSIFY_CONCURRENCY, async (batch) => {
        try {
            const topics = await ollamaClassify(batch);

            // one update per topic
            const idsByTopic = new Map();
            batch.forEach((article, i) => {
                idsByTopic.set(topics[i], [...(idsByTopic.get(topics[i]) ?? []), article.id]);
            });
            for (let [topic, ids] of idsByTopic) {
                await FeedModel.setArticlesTopic(ids, topic);
            }
            classified += batch.length;
        } catch (err) {
            // articles stay without topic and will be retried on next run
            failed += batch.length;
            console.error(`Classification failed for ${batch.length} articles: ${err}`);
        }
    });

    const stats = { classified, failed, ms: Date.now() - start };
    if (articles.length > 0) console.log(`Articles classified: ${JSON.stringify(stats)}`);
    return stats;
};

export const FeedService = {
    // fetch every feed and save the new articles
    refresh: () => {
        if (!running) {
            running = doRefresh().finally(() => running = null);
        }
        return running;
    },

    // classify the articles without topic
    classify: () => {
        if (!classifying) {
            classifying = doClassify().finally(() => classifying = null);
        }
        return classifying;
    },

    // refresh then classify the new articles, the classification is not awaited by the searches
    refreshAndClassify: () => {
        const refresh = FeedService.refresh();
        refresh
            .then(() => FeedService.classify())
            .catch(err => console.error(`Feeds refresh or classification failed: ${err}`));
        return refresh;
    },

    // resolves once the cache has been filled at least once
    ready: () => {
        if (!firstRun) {
            firstRun = FeedService.refresh().catch(err => {
                firstRun = null;    // retry on next call
                throw err;
            });
        }
        return firstRun;
    },

    // refresh now, then every REFRESH_MINUTES
    start: () => {
        if (timer) return;

        FeedService.ready()
            .then(() => FeedService.classify())
            .catch(err => console.error(`First feeds refresh failed: ${err}`));
        timer = setInterval(() => {
            FeedService.refreshAndClassify().catch(() => {});   // error already logged
        }, REFRESH_MINUTES * 60 * 1000);
    },

    stop: () => {
        clearInterval(timer);
        timer = null;
    },
}
