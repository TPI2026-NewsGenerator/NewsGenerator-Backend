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
    // oldest fetch of these feeds, null when one of them was never fetched (a source just added):
    // the cache is only fresh when every feed the search needs has been read
    oldestFetch: async (urls) => {
        const feeds = await prisma.feeds.findMany({
            where: { url: { in: urls } },
            select: { last_fetched_at: true },
        });

        if (feeds.length < new Set(urls).size) return null;      // a feed is not in the table yet

        const dates = feeds.map(feed => feed.last_fetched_at);
        return dates.some(date => !date) ? null : new Date(Math.min(...dates.map(date => date.getTime())));
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
                   a.published_at, a.created_at, a.topic, a.summary, a.sourcing
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[])
              AND ($2::timestamptz IS NULL OR COALESCE(a.published_at, a.created_at) >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR COALESCE(a.published_at, a.created_at) <= $3::timestamptz)
              AND ${keywordsSql.sql}
            ORDER BY COALESCE(a.published_at, a.created_at) DESC`,
            feedUrls, timeframe.start ?? null, timeframe.end ?? null, ...keywordsSql.params);
    },
    // hostnames of the articles already saved for these feeds. A feed is often served from another
    // address than the site it publishes ("feeds.bbci.co.uk" for bbc.com, "feeds.content.dowjones.io"
    // for wsj.com, feedburner and flipboard for anybody), so the links of the articles are the only
    // reliable way to know which media are really searched
    articleHosts: async (feedUrls) => {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT DISTINCT lower(substring(a.link from '^https?://(?:www[.])?([^/:?#]+)')) AS host
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[])`,
            feedUrls);

        return rows.map(row => row.host).filter(Boolean);
    },
    // groups of articles telling the same news, found with the trigram similarity of their titles
    // returns the pairs above the threshold, the grouping is done by the caller
    similarArticlePairs: async (ids, threshold, {shortTitle, shortThreshold}) => {
        if (ids.length < 2) return [];

        // the similarity itself is returned: above the threshold two articles tell the same news,
        // and far above it they are the same copy of the same wire, republished.
        //
        // A short title is mostly the template its paper puts around it: "Health Care Roundup:
        // Market Talk" and "Auto & Transport Roundup: Market Talk" share everything but the sector.
        // So under 'shortTitle' characters the old, stricter threshold is kept: those pairs stay
        // apart, as they did before, rather than being wrongly merged into one news.
        return prisma.$queryRawUnsafe(`
            SELECT a.id AS id_a, b.id AS id_b, similarity(a.title, b.title) AS score
            FROM articles a
            JOIN articles b ON b.id > a.id AND b.id = ANY($1::int[])
            WHERE a.id = ANY($1::int[])
              AND similarity(a.title, b.title) >= CASE
                  WHEN least(length(a.title), length(b.title)) < $3::int THEN $4::real
                  ELSE $2::real END`,
            ids, threshold, shortTitle, shortThreshold);
    },
    // one article per link, even if it is in several feeds
    getArticlesByLinks: async (links) => {
        return prisma.articles.findMany({
            where: { link: { in: links } },
            distinct: ['link'],
        });
    },
    // the AI resume, topic and sourcing are kept, a news asked twice is not summarized twice
    saveSummary: async (link, summary, topic, sourcing) => {
        return prisma.articles.updateMany({
            where: { link: link },
            data: { summary: summary, topic: topic, sourcing: sourcing },
        });
    },
    // feeds added by a user, they are private: only used in the searches of this user
    // with the state of the last refresh of each feed, so the user sees a source that stopped working
    listUserFeeds: async (userId) => {
        const userFeeds = await prisma.user_feeds.findMany({
            where: { id_user: userId },
            orderBy: { created_at: 'desc' },
        });

        const feeds = await prisma.feeds.findMany({
            where: { url: { in: userFeeds.map(feed => feed.url) } },
            select: { url: true, last_error: true, last_fetched_at: true },
        });
        const status = new Map(feeds.map(feed => [feed.url, feed]));

        return userFeeds.map(feed => ({ ...feed, ...status.get(feed.url) }));
    },
    countUserFeeds: async (userId) => {
        return prisma.user_feeds.count({ where: { id_user: userId } });
    },
    addUserFeed: async ({userId, url, site, category}) => {
        return prisma.user_feeds.create({
            data: { id_user: userId, url: url, site: site, category: category },
        });
    },
    deleteUserFeed: async (userId, id) => {
        const { count } = await prisma.user_feeds.deleteMany({
            where: { id: id, id_user: userId },
        });
        return count;
    },
    // urls of the feeds of this user, only those of these categories when they are given
    userFeedUrls: async (userId, categories = null) => {
        const feeds = await prisma.user_feeds.findMany({
            where: { id_user: userId, ...(categories ? { category: { in: categories } } : {}) },
            select: { url: true },
            distinct: ['url'],
        });
        return feeds.map(feed => feed.url);
    },
    deleteArticlesOlderThan: async (date) => {
        const { count } = await prisma.articles.deleteMany({
            where: { created_at: { lt: date } }
        });
        return count;
    },
}
