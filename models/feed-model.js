//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-model.js
//  Description: Model for RSS feeds cache (feeds and articles)
//

"use strict"

import {prisma} from '../config/db.js';
import {Filter} from '../services/utils/filter.js';

export const FeedModel = {
    // make sure every url has a row in feeds, then return these rows
    syncFeeds: async (urls) => {
        await prisma.feeds.createMany({
            data: urls.map(url => ({ url })),
            skipDuplicates: true,
        });

        return prisma.feeds.findMany({
            where: { url: { in: urls } }
        });
    },
    // categories of the feeds (db/rss-links.js), used by the custom searches
    syncCategories: async (names) => {
        const { count } = await prisma.categories.createMany({
            data: names.map(category_name => ({ category_name })),
            skipDuplicates: true,
        });
        return count;
    },
    updateFeed: async (id, data) => {
        return prisma.feeds.update({
            where: { id: id },
            data: data,
        });
    },
    // when the feeds were fetched for the last time, null when the cache is empty
    lastFetchedAt: async () => {
        const { _max } = await prisma.feeds.aggregate({ _max: { last_fetched_at: true } });
        return _max.last_fetched_at;
    },
    // articles already saved (same feed and link) are ignored
    insertArticles: async (articles) => {
        const { count } = await prisma.articles.createMany({
            data: articles,
            skipDuplicates: true,
        });
        return count;
    },
    // articles of these feeds matching the search, filtered in SQL so only the results leave the database
    // keywords: from Filter.parse, timeframe: {start, end} on the publication date (the date we saw the news
    // when the feed gives none), both optional
    searchArticles: async ({feedUrls, keywords, timeframe = {}}) => {
        // $1 to $3 are used below, the keyword patterns start at $4
        // search_text is prepared by Postgres and has a trigram index, so the regex search uses the index
        const keywordsSql = Filter.keywordsSql(keywords, 4, 'a.search_text');
        if (!keywordsSql) return [];

        return prisma.$queryRawUnsafe(`
            SELECT a.id, a.id_feed, a.link, a.title, a.description, a.thumbnail, a.category,
                   a.published_at, a.created_at, a.topic, a.summary
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[])
              AND ($2::timestamptz IS NULL OR COALESCE(a.published_at, a.created_at) >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR COALESCE(a.published_at, a.created_at) <= $3::timestamptz)
              AND ${keywordsSql.sql}
            ORDER BY COALESCE(a.published_at, a.created_at) DESC`,
            feedUrls, timeframe.start ?? null, timeframe.end ?? null, ...keywordsSql.params);
    },
    // groups of articles telling the same news, found with the trigram similarity of their titles
    // returns the pairs above the threshold, the grouping is done by the caller
    similarArticlePairs: async (ids, threshold) => {
        if (ids.length < 2) return [];

        return prisma.$queryRawUnsafe(`
            SELECT a.id AS id_a, b.id AS id_b
            FROM articles a
            JOIN articles b ON b.id > a.id AND b.id = ANY($1::int[])
            WHERE a.id = ANY($1::int[])
              AND similarity(a.title, b.title) >= $2::real`,
            ids, threshold);
    },
    // one article per link, even if it is in several feeds
    getArticlesByLinks: async (links) => {
        return prisma.articles.findMany({
            where: { link: { in: links } },
            distinct: ['link'],
        });
    },
    // the AI resume and topic are kept, a news asked twice is not summarized twice
    saveSummary: async (link, summary, topic) => {
        return prisma.articles.updateMany({
            where: { link: link },
            data: { summary: summary, topic: topic },
        });
    },
    deleteArticlesOlderThan: async (date) => {
        const { count } = await prisma.articles.deleteMany({
            where: { created_at: { lt: date } }
        });
        return count;
    },
}
