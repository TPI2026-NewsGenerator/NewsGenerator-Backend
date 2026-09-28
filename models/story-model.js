//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: story-model.js
//  Description: Model for the vectors of the news and the stories they are grouped in. The vectors
//               are pgvector columns: written as text and compared in SQL (db/add_briefing.sql)
//

"use strict"

import {prisma} from '../config/db.js';

const UPDATE_CHUNK = 200;       // news written in one statement

export const StoryModel = {
    // the news still without vectors, published since 'since', the newest first. The language of
    // their feed is given when the feed says it (a feed of a user or of a profile), the text decides
    // otherwise
    pendingArticles: async (since, limit, urls = null) => prisma.$queryRawUnsafe(`
        SELECT a.id, a.title, a.description, f.url AS feed,
               (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1) AS feed_language
        FROM articles a
        JOIN feeds f ON f.id = a.id_feed
        WHERE a.embedded_at IS NULL
          AND COALESCE(a.published_at, a.created_at) >= $1::timestamptz
          AND ($3::text[] IS NULL OR f.url = ANY($3::text[]))
        ORDER BY COALESCE(a.published_at, a.created_at) DESC
        LIMIT $2::int`,
        since, limit, urls),

    // rows: [{id, lang, titleDense, titleSparse, textDense, textSparse}], the vectors as pgvector
    // reads them (see toVector and toSparsevec in embedder.js)
    saveVectors: async (rows) => {
        for (let i = 0; i < rows.length; i += UPDATE_CHUNK) {
            const chunk = rows.slice(i, i + UPDATE_CHUNK);
            await prisma.$executeRawUnsafe(`
                UPDATE articles a
                SET lang = v.lang,
                    title_dense = v.title_dense::vector,
                    title_sparse = v.title_sparse::sparsevec,
                    text_dense = v.text_dense::vector,
                    text_sparse = v.text_sparse::sparsevec,
                    embedded_at = now()
                FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
                     AS v(id, lang, title_dense, title_sparse, text_dense, text_sparse)
                WHERE a.id = v.id`,
                chunk.map(row => row.id), chunk.map(row => row.lang),
                chunk.map(row => row.titleDense), chunk.map(row => row.titleSparse),
                chunk.map(row => row.textDense), chunk.map(row => row.textSparse));
        }
    },

    // the news embedded and in no story join the stories of the window, in the database
    // (assign_stories): {grouped, created}
    assignStories: async ({since, threshold, sparseWeight, sameMediumMargin, textThreshold, idleDecay, idleGrace}) => {
        const [result] = await prisma.$queryRawUnsafe(
            'SELECT grouped, created FROM public.assign_stories($1::timestamptz, $2::real, $3::real, $4::real, $5::real, $6::real, $7::real)',
            since, threshold, sparseWeight, sameMediumMargin, textThreshold, idleDecay, idleGrace);
        return result;
    },

    // the stories grouped since their thread was judged join the threads of their affair, in the
    // database (assign_threads, db/add_threads.sql): {touched, created, merged}
    assignThreads: async ({threshold, sameMediumMargin, mergeThreshold, activeDays}) => {
        const [result] = await prisma.$queryRawUnsafe(
            'SELECT touched, created, merged FROM public.assign_threads($1::real, $2::real, $3::real, $4::int)',
            threshold, sameMediumMargin, mergeThreshold, activeDays);
        return result;
    },

    // the stories left without news once the old news are deleted, then the threads left without story
    deleteEmptyStories: async () => {
        await prisma.$executeRawUnsafe(`
            DELETE FROM stories s WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id_story = s.id)`);
        await prisma.$executeRawUnsafe(`
            DELETE FROM threads t WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id_thread = t.id)`);
    },

    // the stories closest to the interests of this user (rank_stories), the best first:
    // [{id_story, id_article (its best news), id_interest, score}]
    rank: async ({userId, feedUrls, languages, since, sparseWeight, excluded, limit}) => prisma.$queryRawUnsafe(
        'SELECT * FROM public.rank_stories($1::int, $2::text[], $3::text[], $4::timestamptz, $5::real, $6::int[], $7::int)',
        userId, feedUrls, languages, since, sparseWeight, excluded, limit),

    // the news of these stories the user can read, once per link, the newest first
    storyArticles: async ({storyIds, feedUrls, since}) => prisma.$queryRawUnsafe(`
        SELECT * FROM (
            SELECT DISTINCT ON (a.link)
                   a.id, a.id_story, a.link, a.title, a.description, a.thumbnail, f.url AS feed_url,
                   a.medium, a.source_url, a.resolved_link,
                   COALESCE(a.published_at, a.created_at) AS at
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE a.id_story = ANY($1::int[])
              AND f.url = ANY($2::text[])
              AND COALESCE(a.published_at, a.created_at) >= $3::timestamptz
            ORDER BY a.link, COALESCE(a.published_at, a.created_at) DESC
        ) news
        ORDER BY at DESC`,
        storyIds, feedUrls, since),
};
