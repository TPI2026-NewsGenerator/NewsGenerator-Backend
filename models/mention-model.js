//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: mention-model.js
//  Description: The names each news names, found by the tagger, and the items of Wikidata they are
//               (db/add_named_entities.sql)
//

"use strict"

import {prisma} from '../config/db.js';

const ARTICLE = `a.id, a.id_feed, a.link, a.title, a.description, a.published_at, a.created_at, a.id_story,
       a.source_url, a.resolved_link, a.medium, a.lang`;

export const MentionModel = {
    // [{id, title, description, lang}]: the news created since 'since' the tagger has not read, the
    // newest first, none of 'taken' (the ones another tagger is reading)
    untagged: async ({since, limit, taken = []}) => prisma.$queryRawUnsafe(`
        SELECT a.id, a.title, a.description, a.lang FROM articles a
        WHERE a.entities_at IS NULL AND a.created_at >= $1::timestamptz AND NOT (a.id = ANY($2::int[]))
        ORDER BY a.created_at DESC LIMIT $3`, since, taken, limit),

    // how many news created since 'since' the tagger has not read
    untaggedCount: async (since) => (await prisma.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM articles WHERE entities_at IS NULL AND created_at >= $1::timestamptz`, since))[0].n,

    // The names of news tagged: tagged [{id, lang, names: [{key, kind, name}]}]. The names new are
    // added, the ones known counted once more per news, then the news say which they name and that
    // they were read, in one transaction. A news deleted meanwhile (the retention) is skipped. The
    // names in the order of their key: two taggers adding the same ones wait for each other instead
    // of locking each other
    save: async (tagged) => {
        const counts = new Map();
        for (const news of tagged) {
            for (const {key, kind, name} of news.names) {
                const known = counts.get(`${kind} ${key}`);
                if (known) known.seen++;
                else counts.set(`${kind} ${key}`, {key, kind, name, lang: news.lang ?? null, seen: 1});
            }
        }
        const names = [...counts.values()].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
        return prisma.$transaction(async (tx) => {
            const ids = names.length === 0 ? [] : await tx.$queryRawUnsafe(`
                INSERT INTO mentions (key, kind, name, lang, seen)
                SELECT n.key, n.kind, n.name, n.lang, n.seen
                FROM jsonb_to_recordset($1::jsonb) AS n(key text, kind text, name text, lang text, seen int)
                ON CONFLICT (key, kind) DO UPDATE SET seen = mentions.seen + EXCLUDED.seen
                RETURNING id, key, kind`, JSON.stringify(names));
            const idOf = new Map(ids.map(row => [`${row.kind} ${row.key}`, row.id]));
            const links = tagged.flatMap(news => news.names.map(({key, kind}) => ({article: news.id, mention: idOf.get(`${kind} ${key}`)})));
            if (links.length > 0) await tx.$executeRawUnsafe(`
                INSERT INTO article_mentions (id_mention, id_article)
                SELECT l.mention, a.id FROM jsonb_to_recordset($1::jsonb) AS l(article int, mention int)
                JOIN articles a ON a.id = l.article
                ON CONFLICT DO NOTHING`, JSON.stringify(links));
            await tx.$executeRawUnsafe(`UPDATE articles SET entities_at = now() WHERE id = ANY($1::int[])`, tagged.map(news => news.id));
            return names.length;
        }, {timeout: 120000});
    },

    // [{id, name, lang, seen}]: the names never looked for in Wikidata named by 'least' news at least,
    // the most named first
    toLink: async ({least, limit}) => prisma.$queryRawUnsafe(`
        SELECT id, name, lang, seen FROM mentions WHERE linked_at IS NULL AND seen >= $1
        ORDER BY seen DESC LIMIT $2`, least, limit),

    // the item of Wikidata a name is, null when none or several are called so: looked for now
    setLink: async (id, qid) => prisma.$executeRawUnsafe(`
        UPDATE mentions SET qid = $2, linked_at = now() WHERE id = $1`, id, qid),

    // The names of these news: [{id, name, kind, qid, lang, linkedAt, inCard, news}], inCard the news of
    // them naming it, news the news naming it at all, counted up to 'upTo' (the UEFA would be counted
    // in full otherwise, to be left out)
    namesOfArticles: async (articleIds, upTo) => articleIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        WITH card AS (
            SELECT id_mention, count(*)::int AS in_card FROM article_mentions
            WHERE id_article = ANY($1::int[]) GROUP BY id_mention
        )
        SELECT m.id, m.name, m.kind, m.qid, m.lang, m.linked_at AS "linkedAt", c.in_card AS "inCard",
               (SELECT count(*) FROM (SELECT 1 FROM article_mentions x WHERE x.id_mention = m.id LIMIT $2) t)::int AS news
        FROM card c JOIN mentions m ON m.id = c.id_mention`, articleIds, upTo),

    // [{id_story, id_article, shared, likeness}]: the stories of these feeds with a news since 'since'
    // naming one of these names, or a name of the same item of Wikidata, none of 'excluded', at least
    // 'likeness' close to the story 'storyId' (the cosine of their centroids), the closest first.
    // id_article: its newest news naming them, shared: how many of the names (an item once)
    storiesNaming: async ({storyId, mentionIds, qids, feedUrls, since, excluded, likeness, limit}) => prisma.$queryRawUnsafe(`
        WITH names AS (
            SELECT id, COALESCE(qid, 'm' || id) AS item FROM mentions WHERE id = ANY($1::int[]) OR qid = ANY($2::text[])
        ), naming AS (
            SELECT a.id_story, count(DISTINCT n.item)::int AS shared,
                   (array_agg(a.id ORDER BY COALESCE(a.published_at, a.created_at) DESC))[1] AS id_article
            FROM names n
            JOIN article_mentions am ON am.id_mention = n.id
            JOIN articles a ON a.id = am.id_article
            JOIN feeds f ON f.id = a.id_feed
            WHERE a.id_story IS NOT NULL AND NOT (a.id_story = ANY($5::int[]))
              AND f.url = ANY($3::text[]) AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz
            GROUP BY a.id_story
        )
        SELECT g.id_story, g.id_article, g.shared, (-(o.centroid <#> c.centroid))::real AS likeness
        FROM naming g
        JOIN stories o ON o.id = g.id_story
        CROSS JOIN (SELECT centroid FROM stories WHERE id = $6) c
        WHERE o.centroid IS NOT NULL AND -(o.centroid <#> c.centroid) >= $7
        ORDER BY o.centroid <#> c.centroid LIMIT $8`, mentionIds, qids, feedUrls, since, excluded, storyId, likeness, limit),

    // The news of these feeds since 'since' naming one of these names (their keys) or an item of
    // Wikidata of these: the article with the keys and the items it names of them, the newest first
    articlesNamed: async ({keys, qids, feedUrls, since}) => keys.length === 0 && qids.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT ${ARTICLE}, array_agg(DISTINCT m.key) AS keys,
               COALESCE(array_agg(DISTINCT m.qid) FILTER (WHERE m.qid IS NOT NULL), '{}') AS qids
        FROM mentions m
        JOIN article_mentions am ON am.id_mention = m.id
        JOIN articles a ON a.id = am.id_article
        JOIN feeds f ON f.id = a.id_feed
        WHERE (m.key = ANY($1::text[]) OR m.qid = ANY($2::text[]))
          AND f.url = ANY($3::text[]) AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz
        GROUP BY a.id
        ORDER BY COALESCE(a.published_at, a.created_at) DESC`, keys, qids, feedUrls, since),

    // the names no news names any more, never looked for in Wikidata: the item of the others is kept
    deleteUnused: async () => prisma.$executeRawUnsafe(`
        DELETE FROM mentions m WHERE m.linked_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM article_mentions am WHERE am.id_mention = m.id)`),
};
