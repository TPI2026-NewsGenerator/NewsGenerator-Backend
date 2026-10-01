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
                   OR f.url IN (SELECT url FROM user_feeds WHERE origin = 'profile' OR shared)
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

    // feeds: [{url, medium, origin, language, category}], the ones already there left as they are
    addFeeds: (feeds) => prisma.directory_feeds.createMany({data: feeds, skipDuplicates: true}),

    // a medium looked at, with the number of feeds kept and why none was
    tried: (medium, origin, kept, reason = null) => prisma.directory_tries.upsert({
        where: {medium_origin: {medium, origin}},
        create: {medium, origin, kept, reason},
        update: {tried_at: new Date(), kept, reason},
    }),
};
