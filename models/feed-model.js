//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-model.js
//  Description: Model for RSS feeds cache (feeds and articles)
//

"use strict"

import {prisma} from '../config/db.js';
import {Filter} from '../services/utils/filter.js';

const INSERT_SLICE = 1000;      // rows per INSERT, 7 values each: far under the 65535 of Postgres

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
    // articles already saved (same feed and link) are ignored
    // A refresh of every feed gives thousands of rows. Prisma (7.8 to 7.10) cuts such a createMany into
    // several INSERTs of one transaction and sends them together on its connection, which pg 8 only
    // warns about and pg 9 will refuse: the slices are sent one after the other here instead
    insertArticles: async (articles) => {
        let inserted = 0;
        for (let i = 0; i < articles.length; i += INSERT_SLICE) {
            const { count } = await prisma.articles.createMany({
                data: articles.slice(i, i + INSERT_SLICE),
                skipDuplicates: true,
            });
            inserted += count;
        }
        return inserted;
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
        // The accents are removed before comparing. Two papers do not spell a name the same way:
        // the Guardian writes "Higuaín" where the Independent writes "Higuain", and that single
        // accent changes enough trigrams to move the pair from 0.325 to 0.294, which is the
        // difference between grouped and not grouped. It matters most in French, Spanish and
        // Italian, where accents are everywhere.
        //
        // A short title is mostly the template its paper puts around it: "Health Care Roundup:
        // Market Talk" and "Auto & Transport Roundup: Market Talk" share everything but the sector.
        // So under 'shortTitle' characters the old, stricter threshold is kept: those pairs stay
        // apart, as they did before, rather than being wrongly merged into one news.
        return prisma.$queryRawUnsafe(`
            SELECT a.id AS id_a, b.id AS id_b,
                   similarity(unaccent(a.title), unaccent(b.title)) AS score
            FROM articles a
            JOIN articles b ON b.id > a.id AND b.id = ANY($1::int[])
            WHERE a.id = ANY($1::int[])
              AND similarity(unaccent(a.title), unaccent(b.title)) >= CASE
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
    // the feeds added by hand by default, the ones found for the profile have their own limit
    // (see utils/feed-limits.js)
    countUserFeeds: async (userId, origin = 'user') => {
        return prisma.user_feeds.count({ where: { id_user: userId, origin: origin } });
    },
    addUserFeed: async ({userId, url, site, category, language = null}) => {
        return prisma.user_feeds.create({
            data: { id_user: userId, url: url, site: site, category: category, language: language },
        });
    },
    // {trusted, shared}, only on a source added by hand: one found for the profile is removed once it
    // brings nothing on it, and is already a public find (see RecommendationService)
    updateUserFeed: async (userId, id, data) => {
        const { count } = await prisma.user_feeds.updateMany({
            where: { id: id, id_user: userId, origin: 'user' },
            data: data,
        });
        return count;
    },
    getUserFeed: async (userId, id) => prisma.user_feeds.findFirst({ where: { id: id, id_user: userId } }),
    // The feeds this reader could add: the ones read for other readers for a public reason, found by
    // the discovery of a profile or shared by the reader who added them, never a feed another reader
    // only added by hand. Those whose news of the last days are on the interests of this reader, with
    // how many: their title reaches 'threshold' with one of them, as for the discovery.
    // excluded: feeds never suggested (the shared ones, the ones the thumbs of this reader left out)
    // [{id, url, site, category, language, news, relevant, samples}], the most relevant first
    recommendedFeeds: async (userId, {excluded, languages, since, threshold, minRelevant, limit}) => prisma.$queryRawUnsafe(`
        WITH candidates AS (
            SELECT DISTINCT ON (uf.url) f.id, uf.url, uf.category, uf.language
            FROM user_feeds uf
            JOIN feeds f ON f.url = uf.url
            WHERE uf.id_user <> $1::int
              AND (uf.origin = 'profile' OR uf.shared)
              AND uf.url <> ALL($2::text[])
              AND NOT EXISTS (SELECT 1 FROM user_feeds mine WHERE mine.id_user = $1::int AND mine.url = uf.url)
            ORDER BY uf.url, (uf.origin = 'profile') DESC, uf.created_at
        ), scored AS (
            SELECT c.id, a.title,
                   (SELECT max(-(a.title_dense <#> i.dense)) FROM profile_interests i
                    WHERE i.id_user = $1::int AND i.dense IS NOT NULL) AS score
            FROM candidates c
            JOIN articles a ON a.id_feed = c.id
            WHERE a.embedded_at IS NOT NULL AND a.created_at >= $4::timestamptz AND a.lang = ANY($3::text[])
        )
        SELECT c.id, c.url, c.category, c.language,
               count(*)::int AS news,
               count(*) FILTER (WHERE s.score >= $5::real)::int AS relevant,
               (array_agg(s.title ORDER BY s.score DESC))[1:2] AS samples
        FROM candidates c
        JOIN scored s ON s.id = c.id
        GROUP BY c.id, c.url, c.category, c.language
        HAVING count(*) FILTER (WHERE s.score >= $5::real) >= $6::int
        ORDER BY relevant DESC, news
        LIMIT $7::int`,
        userId, excluded, languages, since, threshold, minRelevant, limit),
    trustedFeedUrls: async (userId) => (await prisma.user_feeds.findMany({
        where: { id_user: userId, origin: 'user', trusted: true },
        select: { url: true },
    })).map(feed => feed.url),
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
    // the feeds of every user, read by the worker (see IngestService.run)
    allUserFeedUrls: async () => {
        const feeds = await prisma.user_feeds.findMany({select: {url: true}, distinct: ['url']});
        return feeds.map(feed => feed.url);
    },
    deleteArticlesOlderThan: async (date) => {
        const { count } = await prisma.articles.deleteMany({
            where: { created_at: { lt: date } }
        });
        return count;
    },
}
