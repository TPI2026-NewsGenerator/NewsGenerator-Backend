//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: directory-model.js
//  Description: Model for the directory of the project: the feeds the server found itself, and the
//               media it looked at (db/add_directory.sql)
//

"use strict"

import {prisma} from '../config/db.js';

const GOOGLE_FEEDS = 'https://news.google.com/%';

export const DirectoryModel = {
    // the feeds a search of these categories reads in this language (every language without one): those
    // of a medium on everything (no category) too
    feedUrls: async (categories, language = null) => (await prisma.directory_feeds.findMany({
        where: {
            AND: [
                {OR: [{category: null}, {category: {in: categories}}]},
                ...(language ? [{OR: [{language}, {language: null}]}] : []),
            ],
        },
        select: {url: true},
    })).map(feed => feed.url),

    // every feed of the directory, read by the ingestion: [{url, medium, origin, language, category}]
    all: () => prisma.directory_feeds.findMany(),

    // The media Google News named at least 'minNews' times these 'days' in the searches the server read
    // (those of the profiles, and the sentences a search asked it),
    // that no feed every reader can search reads (the ones of db/rss-links.js, 'sharedUrls', the ones
    // found for a profile or shared, the directory) and not looked at since 'retryDays', the most named first:
    // [{medium, site, news}], 'site' the address Google gives of the publisher
    namedMedia: ({sharedUrls, days, minNews, retryDays, limit}) => prisma.$queryRawUnsafe(`
        WITH read AS (
            SELECT DISTINCT a.medium
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE (f.url = ANY($1::text[])
                   OR f.url IN (SELECT url FROM user_feeds)
                   OR f.url IN (SELECT url FROM directory_feeds))
              AND a.created_at > now() - make_interval(days => $2::int)
              AND a.medium IS NOT NULL
        ), named AS (
            SELECT a.medium, count(*)::int AS news,
                   mode() WITHIN GROUP (ORDER BY a.source_url) AS site
            FROM articles a
            JOIN feeds f ON f.id = a.id_feed
            WHERE f.url LIKE '${GOOGLE_FEEDS}' AND a.created_at > now() - make_interval(days => $2::int)
              AND a.medium IS NOT NULL
            GROUP BY a.medium
        )
        SELECT n.*
        FROM named n
        WHERE n.news >= $3::int
          AND NOT EXISTS (SELECT 1 FROM read r WHERE r.medium = n.medium)
          AND NOT EXISTS (SELECT 1 FROM directory_feeds d WHERE d.medium = n.medium)
          AND NOT EXISTS (SELECT 1 FROM directory_tries t WHERE t.medium = n.medium AND t.origin = 'named'
                                                            AND t.tried_at > now() - make_interval(days => $4::int))
        ORDER BY n.news DESC
        LIMIT $5::int`,
        sharedUrls, days, minNews, retryDays, limit),

    // the media among these looked at for 'origin' since 'retryDays'
    triedSince: async (media, origin, retryDays) => new Set((await prisma.$queryRawUnsafe(`
        SELECT medium FROM directory_tries
        WHERE medium = ANY($1::text[]) AND origin = $2 AND tried_at > now() - make_interval(days => $3::int)`,
        media, origin, retryDays)).map(row => row.medium)),

    // the medium of the news of each of these feeds, the most frequent: the address of a feed does not
    // always name its medium ("feeds.content.dowjones.io" is the WSJ). [{url, medium}]
    mediaOfFeeds: (feedUrls) => prisma.$queryRawUnsafe(`
        SELECT f.url, mode() WITHIN GROUP (ORDER BY a.medium) AS medium
        FROM articles a
        JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND a.medium IS NOT NULL
        GROUP BY f.url`,
        feedUrls),

    // the addresses of the news of these feeds these days
    linksOf: async (feedUrls, days) => (await prisma.$queryRawUnsafe(`
        SELECT a.link
        FROM articles a
        JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND a.created_at > now() - make_interval(days => $2::int)`,
        feedUrls, days)).map(row => row.link),

    // Every feed of the directory with what it gives the readers: its news of the last 'newsDays' that
    // got vectors, how many of them reach 'threshold' with an interest of a profile, any reader's, and
    // whether a briefing of the last 'usedDays' showed a news of a feed of the directory of its medium
    // (a card, its articles, its other angles, its denials, the news of the terms followed). A medium
    // shown through Google News only does not count: its feed of the directory brought nothing to it.
    // [{url, medium, origin, language, category, created_at, news, relevant, used}]
    usage: ({usedDays, newsDays, threshold}) => prisma.$queryRawUnsafe(`
        WITH shown AS (
            SELECT DISTINCT x #>> '{}' AS link
            FROM briefings b,
                 jsonb_path_query(jsonb_build_array(b.items, coalesce(b.watched, '[]'::jsonb)), 'strict $.**.url') x
            WHERE b.status = 'ready' AND b.created_at > now() - make_interval(days => $1::int)
        ), shown_feeds AS (
            SELECT a.id_feed FROM articles a JOIN shown s ON s.link = a.link
            UNION
            SELECT a.id_feed FROM articles a JOIN shown s ON s.link = a.resolved_link
        ), used AS (
            SELECT DISTINCT d.medium
            FROM shown_feeds sf JOIN feeds f ON f.id = sf.id_feed JOIN directory_feeds d ON d.url = f.url
        )
        SELECT d.url, d.medium, d.origin, d.language, d.category, d.created_at,
               count(a.id)::int AS news,
               count(a.id) FILTER (WHERE EXISTS (
                   SELECT 1 FROM profile_interests i
                   WHERE i.dense IS NOT NULL AND -(a.text_dense <#> i.dense) >= $3::real))::int AS relevant,
               d.medium IN (SELECT medium FROM used) AS used
        FROM directory_feeds d
        LEFT JOIN feeds f ON f.url = d.url
        LEFT JOIN articles a ON a.id_feed = f.id AND a.embedded_at IS NOT NULL
                            AND a.created_at >= now() - make_interval(days => $2::int)
        GROUP BY d.url`,
        usedDays, newsDays, threshold),

    // what the readers asked these days: the briefings made, the interests with a vector, and the
    // categories of those interests. {briefings, interests, categories}
    readers: async (days) => {
        const [row] = await prisma.$queryRawUnsafe(`
            SELECT (SELECT count(*) FROM briefings
                    WHERE status = 'ready' AND created_at > now() - make_interval(days => $1::int))::int AS briefings,
                   (SELECT count(*) FROM profile_interests WHERE dense IS NOT NULL)::int AS interests,
                   (SELECT coalesce(array_agg(DISTINCT category), '{}') FROM profile_interests
                    WHERE category IS NOT NULL) AS categories`,
            days);
        return row;
    },

    // These feeds out of the directory, noted with why: [{url, medium, origin, language, category, news,
    // relevant, reason}]. Their news stay, until the retention drops them
    remove: (feeds) => prisma.$transaction([
        prisma.$executeRawUnsafe(`
            INSERT INTO directory_removed (url, medium, origin, language, category, news, relevant, reason)
            SELECT url, medium, origin, language, category, news, relevant, reason
            FROM jsonb_to_recordset($1::jsonb) AS r(url text, medium text, origin text, language text,
                                                   category text, news int, relevant int, reason text)
            ON CONFLICT (url) DO UPDATE SET news = EXCLUDED.news, relevant = EXCLUDED.relevant,
                                            reason = EXCLUDED.reason, removed_at = now()`,
            JSON.stringify(feeds)),
        prisma.$executeRawUnsafe('DELETE FROM directory_feeds WHERE url = ANY($1::text[])', feeds.map(feed => feed.url)),
    ]),

    // the addresses among these taken out of the directory these days, while no profile was created or
    // written since: a new reader may want what served nobody before
    stillRemoved: async (urls, days) => new Set((await prisma.$queryRawUnsafe(`
        SELECT url FROM directory_removed
        WHERE url = ANY($1::text[]) AND removed_at > now() - make_interval(days => $2::int)
          AND removed_at > (SELECT coalesce(max(updated_at), '-infinity') FROM user_profiles)`,
        urls, days)).map(row => row.url)),

    // feeds: [{url, medium, origin, language, category}], the ones already there left as they are
    addFeeds: (feeds) => prisma.directory_feeds.createMany({data: feeds, skipDuplicates: true}),

    // a medium looked at, with the number of feeds kept and why none was
    tried: (medium, origin, kept, reason = null) => prisma.directory_tries.upsert({
        where: {medium_origin: {medium, origin}},
        create: {medium, origin, kept, reason},
        update: {tried_at: new Date(), kept, reason},
    }),
};
