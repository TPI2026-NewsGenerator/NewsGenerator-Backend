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
    // the news still without vectors, published since 'since', the newest first, the ones of the
    // feeds 'last' (the floods, see FLOOD_NEWS_PER_DAY) after all the others. The language of their
    // feed is given when the feed says it (a feed of a user or of a profile), the text decides
    // otherwise
    pendingArticles: async (since, limit, urls = null, last = []) => prisma.$queryRawUnsafe(`
        SELECT a.id, a.title, a.description, f.url AS feed,
               COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                        (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language
        FROM articles a
        JOIN feeds f ON f.id = a.id_feed
        WHERE a.embedded_at IS NULL
          AND COALESCE(a.published_at, a.created_at) >= $1::timestamptz
          AND ($3::text[] IS NULL OR f.url = ANY($3::text[]))
        ORDER BY f.url = ANY($4::text[]), COALESCE(a.published_at, a.created_at) DESC
        LIMIT $2::int`,
        since, limit, urls, last),

    // how many news published since 'since' still have no vectors
    pendingCount: async (since) => Number((await prisma.$queryRawUnsafe(`
        SELECT count(*) AS waiting FROM articles
        WHERE embedded_at IS NULL AND COALESCE(published_at, created_at) >= $1::timestamptz`, since))[0].waiting),

    // rows: [{id, lang, titleDense, titleSparse, textDense, textSparse}], the vectors as pgvector
    // reads them (see toVector and toSparsevec in embedder.js)
    saveVectors: async (rows) => {
        for (let i = 0; i < rows.length; i += UPDATE_CHUNK) {
            const chunk = rows.slice(i, i + UPDATE_CHUNK);
            await prisma.$executeRawUnsafe(`
                UPDATE articles a
                SET lang = v.lang,
                    title_dense = v.title_dense::halfvec,
                    title_sparse = v.title_sparse::sparsevec,
                    text_dense = v.text_dense::halfvec,
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
    // (assign_stories), the newest maxNews of them (all when null): {grouped, created}
    assignStories: async ({since, threshold, sparseWeight, sameMediumMargin, textThreshold, idleDecay, idleGrace, maxNews = null}) => {
        const [result] = await prisma.$queryRawUnsafe(
            'SELECT grouped, created FROM public.assign_stories($1::timestamptz, $2::real, $3::real, $4::real, $5::real, $6::real, $7::real, $8::int)',
            since, threshold, sparseWeight, sameMediumMargin, textThreshold, idleDecay, idleGrace, maxNews);
        return result;
    },

    // the stories grouped since their thread was judged join the threads of their affair, in the
    // database (assign_threads, db/add_threads.sql), the oldest maxStories of them (all when null):
    // {touched, created, merged}
    assignThreads: async ({threshold, sameMediumMargin, mergeThreshold, activeDays, maxStories = null}) => {
        const [result] = await prisma.$queryRawUnsafe(
            'SELECT touched, created, merged FROM public.assign_threads($1::real, $2::real, $3::real, $4::int, $5::int)',
            threshold, sameMediumMargin, mergeThreshold, activeDays, maxStories);
        return result;
    },

    // the stories left without news once the old news are deleted, then the threads left without story
    deleteEmptyStories: async () => {
        await prisma.$executeRawUnsafe(`
            DELETE FROM stories s WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id_story = s.id)`);
        await prisma.$executeRawUnsafe(`
            DELETE FROM threads t WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id_thread = t.id)`);
    },

    // the stories closest to the interests of this profile (rank_profile_stories, db/add_profiles.sql),
    // the best first: [{id_story, id_article (its best news), id_interest, score}]
    // A story already shown can come back: the reader passes it, and it leaves room for more news
    rank: async ({profileId, feedUrls, languages, since, sparseWeight, limit}) => prisma.$queryRawUnsafe(
        'SELECT * FROM public.rank_profile_stories($1::int, $2::text[], $3::text[], $4::timestamptz, $5::real, $6::int[], $7::int)',
        profileId, feedUrls, languages, since, sparseWeight, [], limit),

    // The stories of one language closest to these stories of other languages, by the centroids of
    // their articles (db/add_threads.sql): [{id_story, id_version, likeness}], the perStory closest of
    // each from likeness on, of the last hours and told by a feed the user reads. A story is of one
    // language: the version of a news in the language of the reader is another story
    versionsIn: async ({storyIds, language, feedUrls, since, likeness, perStory}) => prisma.$queryRawUnsafe(`
        SELECT s.id AS id_story, v.id AS id_version, v.likeness
        FROM stories s
        CROSS JOIN LATERAL (
            SELECT o.id, -(o.centroid <#> s.centroid)::real AS likeness
            FROM stories o
            WHERE o.lang = $2 AND o.centroid IS NOT NULL AND o.updated_at >= $4::timestamptz
            ORDER BY o.centroid <#> s.centroid
            LIMIT $6::int
            OFFSET 0
        ) v
        WHERE s.id = ANY($1::int[]) AND s.lang <> $2 AND s.centroid IS NOT NULL
          AND v.likeness >= $5::real
          AND EXISTS (SELECT 1 FROM articles a JOIN feeds f ON f.id = a.id_feed
                      WHERE a.id_story = v.id AND f.url = ANY($3::text[])
                        AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz)
        ORDER BY s.id, v.likeness DESC`,
        storyIds, language, feedUrls, since, likeness, perStory),

    // The same, in every other language but the one of the story and the one of the reader (those are
    // versionsIn): [{id_story, id_version, likeness}]. One fact told in Spanish, German and English is
    // three stories, and the card of one of them counted the media of its language only
    versionsAcross: async ({storyIds, language, feedUrls, since, likeness, perStory}) => prisma.$queryRawUnsafe(`
        SELECT s.id AS id_story, v.id AS id_version, v.likeness
        FROM stories s
        CROSS JOIN LATERAL (
            SELECT o.id, -(o.centroid <#> s.centroid)::real AS likeness
            FROM stories o
            WHERE o.lang <> s.lang AND o.lang <> $2 AND o.centroid IS NOT NULL AND o.updated_at >= $4::timestamptz
            ORDER BY o.centroid <#> s.centroid
            LIMIT $6::int
            OFFSET 0
        ) v
        WHERE s.id = ANY($1::int[]) AND s.centroid IS NOT NULL
          AND v.likeness >= $5::real
          AND EXISTS (SELECT 1 FROM articles a JOIN feeds f ON f.id = a.id_feed
                      WHERE a.id_story = v.id AND f.url = ANY($3::text[])
                        AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz)
        ORDER BY s.id, v.likeness DESC`,
        storyIds, language, feedUrls, since, likeness, perStory),

    // the thread (the affair followed over days, db/add_threads.sql) of each of these stories: [{id, id_thread}]
    threadsOf: async (storyIds) => prisma.$queryRawUnsafe(
        'SELECT id, id_thread FROM stories WHERE id = ANY($1::int[])', storyIds),

    // the news of these stories the user can read, once per link, the newest first
    storyArticles: async ({storyIds, feedUrls, since}) => prisma.$queryRawUnsafe(`
        SELECT * FROM (
            SELECT DISTINCT ON (a.link)
                   a.id, a.id_story, a.link, a.title, a.description, a.thumbnail, a.lang, f.url AS feed_url,
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
