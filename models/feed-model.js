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
    updateFeed: async (id, data) => {
        return prisma.feeds.update({
            where: { id: id },
            data: data,
        });
    },
    // articles already saved (same feed and link) are ignored
    insertArticles: async (articles) => {
        const { count } = await prisma.articles.createMany({
            data: articles,
            skipDuplicates: true,
        });
        return count;
    },
    // articles of these feeds matching the keywords, filtered in SQL so only the results leave the database
    // keywordGroups: from Filter.parse, topics: only these topics, undesiredTopics: without these topics
    // when a topic filter is used, articles not classified yet (topic null) are left out
    searchArticles: async ({feedUrls, topics = [], undesiredTopics = [], keywordGroups}) => {
        if (keywordGroups.length === 0) return [];

        // $1 to $3 are used below, the keyword patterns start at $4
        // search_text is prepared by Postgres and has a trigram index, so the regex search uses the index
        const keywords = Filter.keywordsSql(keywordGroups, 4, 'a.search_text');

        return prisma.$queryRawUnsafe(`
            SELECT a.id, a.id_feed, a.link, a.title, a.description, a.thumbnail, a.category, a.published_at, a.created_at, a.topic
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = ANY($1::text[])
              AND (cardinality($2::text[]) = 0 OR a.topic = ANY($2::text[]))
              AND (cardinality($3::text[]) = 0 OR (a.topic IS NOT NULL AND NOT a.topic = ANY($3::text[])))
              AND (${keywords.sql})
            ORDER BY a.published_at DESC NULLS LAST`,
            feedUrls, topics, undesiredTopics, ...keywords.params);
    },
    // one article per link, even if it is in several feeds
    getArticlesByLinks: async (links) => {
        return prisma.articles.findMany({
            where: { link: { in: links } },
            distinct: ['link'],
        });
    },
    // newest articles without topic first
    getUnclassifiedArticles: async (limit) => {
        return prisma.articles.findMany({
            where: { topic: null },
            select: { id: true, title: true, description: true },
            orderBy: { created_at: 'desc' },
            take: limit,
        });
    },
    setArticlesTopic: async (ids, topic) => {
        return prisma.articles.updateMany({
            where: { id: { in: ids } },
            data: { topic: topic },
        });
    },
    deleteArticlesOlderThan: async (date) => {
        const { count } = await prisma.articles.deleteMany({
            where: { created_at: { lt: date } }
        });
        return count;
    },
}
