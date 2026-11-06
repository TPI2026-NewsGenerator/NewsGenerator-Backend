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

// Whether item_countries has its media column (db/add_item_media.sql): asked once, kept once it has answered,
// so a server started before the migration works as it did and takes it up when it is restarted after it
let mediaColumn = null;
const hasMediaColumn = async () => {
    if (mediaColumn !== null) return mediaColumn;
    try {
        const rows = await prisma.$queryRawUnsafe(`
            SELECT 1 FROM information_schema.columns WHERE table_name = 'item_countries' AND column_name = 'media'`);
        mediaColumn = rows.length > 0;
    } catch {
        return false;
    }
    return mediaColumn;
};

export const MentionModel = {
    // [{id, title, description, lang}]: the news created since 'since' the tagger has not read, the
    // newest first, none of 'taken' (the ones another tagger is reading)
    untagged: async ({since, limit, taken = []}) => prisma.$queryRawUnsafe(`
        SELECT a.id, a.title, a.description, a.lang FROM articles a
        WHERE a.entities_at IS NULL AND a.created_at >= $1::timestamptz AND NOT (a.id = ANY($2::int[]))
        ORDER BY a.created_at DESC LIMIT $3`, since, taken, limit),

    // whether a news created between 'since' and 'before' waits for the tagger: one is enough
    anyUntagged: async (since, before) => (await prisma.$queryRawUnsafe(`
        SELECT EXISTS (SELECT 1 FROM articles WHERE entities_at IS NULL
            AND created_at >= $1::timestamptz AND created_at < $2::timestamptz) AS waiting`, since, before))[0].waiting,

    // how many news created since 'since' the tagger has not read
    untaggedCount: async (since) => (await prisma.$queryRawUnsafe(`
        SELECT count(*)::int AS n FROM articles WHERE entities_at IS NULL AND created_at >= $1::timestamptz`, since))[0].n,

    // The names of news tagged: tagged [{id, lang, names: [{key, kind, name}]}], in one transaction.
    // The news are marked read first, the ones the ingestion holds skipped (it groups them, see
    // assign_stories): waiting for them, the tagger and the ingestion locked each other and Postgres
    // cancelled one (13.10.2026, the graphics card tagging 130 news a second); they are tagged again
    // later. Then the names of the news marked are added, the ones known counted once more per news,
    // in the order of their key: two taggers adding the same ones wait for each other instead of
    // locking each other. A news deleted meanwhile (the retention) is skipped. Answers the news saved
    save: async (tagged) => prisma.$transaction(async (tx) => {
        const marked = new Set((await tx.$queryRawUnsafe(`
            UPDATE articles SET entities_at = now()
            WHERE id IN (SELECT id FROM articles WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE SKIP LOCKED)
            RETURNING id`, tagged.map(news => news.id))).map(row => row.id));
        const saved = tagged.filter(news => marked.has(news.id));
        const counts = new Map();
        for (const news of saved) {
            for (const {key, kind, name} of news.names) {
                const known = counts.get(`${kind} ${key}`);
                if (known) known.seen++;
                else counts.set(`${kind} ${key}`, {key, kind, name, lang: news.lang ?? null, seen: 1});
            }
        }
        const names = [...counts.values()].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
        const ids = names.length === 0 ? [] : await tx.$queryRawUnsafe(`
            INSERT INTO mentions (key, kind, name, lang, seen)
            SELECT n.key, n.kind, n.name, n.lang, n.seen
            FROM jsonb_to_recordset($1::jsonb) AS n(key text, kind text, name text, lang text, seen int)
            ON CONFLICT (key, kind) DO UPDATE SET seen = mentions.seen + EXCLUDED.seen
            RETURNING id, key, kind`, JSON.stringify(names));
        const idOf = new Map(ids.map(row => [`${row.kind} ${row.key}`, row.id]));
        const links = saved.flatMap(news => news.names.map(({key, kind}) => ({article: news.id, mention: idOf.get(`${kind} ${key}`)})));
        if (links.length > 0) await tx.$executeRawUnsafe(`
            INSERT INTO article_mentions (id_mention, id_article)
            SELECT l.mention, l.article FROM jsonb_to_recordset($1::jsonb) AS l(article int, mention int)
            ON CONFLICT DO NOTHING`, JSON.stringify(links));
        return saved.length;
    }, {timeout: 120000}),

    // [{id, name, lang, seen}]: the names never looked for in Wikidata a reader saw first (wanted, see
    // want), the first seen first, whatever their news; then the ones named by 'least' news at least, the
    // most named first, the persons of one word last: Wikidata lets about 12 000 names a day through, and
    // the item called so of a word alone is told on its card (see person-items.js), 26 000 of the 110 000
    // persons waiting (21.10.2026); they come when no other name waits
    toLink: async ({least, limit}) => prisma.$queryRawUnsafe(`
        WITH wanted AS (
            SELECT id FROM mentions WHERE linked_at IS NULL AND wanted_at IS NOT NULL ORDER BY wanted_at LIMIT $2
        ), often AS (
            SELECT id FROM mentions WHERE linked_at IS NULL AND seen >= $1 AND NOT (kind = 'person' AND key NOT LIKE '% %')
            ORDER BY seen DESC LIMIT $2
        ), words AS (
            SELECT id FROM mentions WHERE linked_at IS NULL AND seen >= $1 AND kind = 'person' AND key NOT LIKE '% %'
            ORDER BY seen DESC LIMIT $2
        )
        SELECT m.id, m.name, m.kind, m.lang, m.seen FROM mentions m
        WHERE m.id IN (SELECT id FROM wanted UNION SELECT id FROM often
                       UNION SELECT id FROM words WHERE (SELECT count(*) FROM often) < $2)
        ORDER BY m.wanted_at NULLS LAST, (m.kind = 'person' AND m.key NOT LIKE '% %'), m.seen DESC LIMIT $2`, least, limit),

    // these names (ids) or the names written so (key) looked for in Wikidata before the others: shown to
    // a reader. The ones looked for already are not looked for again, but for the persons in full and the
    // organisations left with no item and no candidates kept (looked for before the candidates were kept):
    // once more, so that the next card choosing among their candidates finds them (see setCandidates)
    want: async ({ids = [], key = null}) => {
        if (ids.length === 0 && !key) return 0;
        const first = await prisma.$executeRawUnsafe(`
            UPDATE mentions SET wanted_at = now()
            WHERE (id = ANY($1::int[]) OR key = $2) AND linked_at IS NULL AND wanted_at IS NULL`, ids, key);
        const again = ids.length === 0 ? 0 : await prisma.$executeRawUnsafe(`
            UPDATE mentions SET linked_at = NULL, wanted_at = now()
            WHERE id = ANY($1::int[]) AND qid IS NULL AND candidates IS NULL AND linked_at IS NOT NULL
              AND kind IN ('person', 'organization') AND NOT (kind = 'person' AND key NOT LIKE '% %')`, ids);
        return first + again;
    },

    // the items (qids) a name may be, kept when the link loop left it with none: [] when it found nothing
    setCandidates: async (id, qids) => prisma.$executeRawUnsafe(`
        UPDATE mentions SET candidates = $2::jsonb WHERE id = $1`, id, JSON.stringify(qids)),

    // Map id -> [qid] of these names that have candidates kept (see setCandidates)
    candidatesOf: async (ids) => ids.length === 0 ? new Map() : new Map((await prisma.$queryRawUnsafe(`
        SELECT id, candidates FROM mentions WHERE id = ANY($1::int[]) AND candidates IS NOT NULL`, ids))
        .map(row => [row.id, row.candidates])),

    // [{word, qid, seen, asPerson, asOther}]: for each of these words (keys of one word: "infantino"),
    // the persons linked to an item whose name ends with it ("gianni infantino"), each item once with how
    // often its writings were met, the most met first; asPerson,
    // asOther: how often the word itself was taken for a person, for anything else. Only the names linked
    // are read (the index of their qid), not the million others
    personsEndingWith: async (words) => words.length === 0 ? [] : prisma.$queryRawUnsafe(`
        WITH w AS (SELECT DISTINCT unnest($1::text[]) AS word),
        own AS (
            SELECT key AS word, COALESCE(sum(seen) FILTER (WHERE kind = 'person'), 0)::int AS as_person,
                   COALESCE(sum(seen) FILTER (WHERE kind <> 'person'), 0)::int AS as_other
            FROM mentions WHERE key = ANY($1::text[]) GROUP BY key
        )
        SELECT w.word, m.qid, sum(m.seen)::int AS seen,
               COALESCE(max(own.as_person), 0)::int AS "asPerson", COALESCE(max(own.as_other), 0)::int AS "asOther"
        FROM w JOIN mentions m ON m.qid IS NOT NULL AND m.kind = 'person' AND m.key LIKE '% ' || w.word
        LEFT JOIN own ON own.word = w.word
        GROUP BY w.word, m.qid
        ORDER BY w.word, seen DESC`, words),

    // [{site, news}]: the sites of the news naming this name ("prosport.ro"), how many each: a byline is
    // of one site, a person of the media of their country (see country-names.js mediaOf)
    sitesNaming: async (id) => prisma.$queryRawUnsafe(`
        SELECT regexp_replace(lower(split_part(a.link, '/', 3)), '^www\\.', '') AS site, count(*)::int AS news
        FROM article_mentions am JOIN articles a ON a.id = am.id_article
        WHERE am.id_mention = $1 GROUP BY 1`, id),

    // [title]: the titles of the newest news naming this name, each title once, 'limit' at most: what the
    // AI reads to tell which item an organisation is (see organization-items.js)
    titlesNaming: async (id, limit) => (await prisma.$queryRawUnsafe(`
        SELECT title FROM (
            SELECT DISTINCT ON (a.title) a.title, a.id FROM article_mentions am JOIN articles a ON a.id = am.id_article
            WHERE am.id_mention = $1 AND a.title IS NOT NULL ORDER BY a.title, a.id DESC LIMIT 200
        ) t ORDER BY id DESC LIMIT $2`, id, limit)).map(row => row.title),

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

    // [{id_article, name, kind, qid}]: the names of these news that are an item of Wikidata, as the news
    // write them, the least met first (the ones a translation guesses the spelling of), 'limit' at most:
    // what a translation is told of how to spell them (see card-spellings.js)
    linkedNamesOf: async (articleIds, limit) => articleIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT am.id_article, m.name, m.kind, m.qid
        FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.qid IS NOT NULL
        ORDER BY m.seen, am.id_article LIMIT $2`, articleIds, limit),

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
    // Wikidata of these: the article with the keys and the items it names of them, the newest first. The
    // links of a name are read from the first news of the window (the ids grow with the days, a day of
    // margin): without it the links of a famous name of the whole month were read for one day, 100 names
    // of a day took 14 s and took 0.16 s with it (bench/mentions-window.mjs)
    articlesNamed: async ({keys, qids, feedUrls, since}) => keys.length === 0 && qids.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT ${ARTICLE}, array_agg(DISTINCT m.key) AS keys,
               COALESCE(array_agg(DISTINCT m.qid) FILTER (WHERE m.qid IS NOT NULL), '{}') AS qids
        FROM mentions m
        JOIN article_mentions am ON am.id_mention = m.id
        JOIN articles a ON a.id = am.id_article
        JOIN feeds f ON f.id = a.id_feed
        WHERE (m.key = ANY($1::text[]) OR m.qid = ANY($2::text[]))
          AND am.id_article >= COALESCE((SELECT first.id FROM articles first
                                         WHERE first.created_at >= $4::timestamptz - interval '1 day'
                                         ORDER BY first.created_at LIMIT 1), 0)
          AND f.url = ANY($3::text[]) AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz
        GROUP BY a.id
        ORDER BY COALESCE(a.published_at, a.created_at) DESC`, keys, qids, feedUrls, since),

    // How many different first words the persons the tagger met carry with each of these family names (a last word of their key):
    // Map family name -> first words ("velasco" 64 of 72 persons, "ceferin" 7). A name no person with a first name carries is not in it
    surnameSpread: async (surnames) => new Map(surnames.length === 0 ? [] : (await prisma.$queryRawUnsafe(`
        SELECT substring(m.key from '[^ ]+$') AS last, count(DISTINCT split_part(m.key, ' ', 1))::int AS firsts
        FROM mentions m
        WHERE m.kind = 'person' AND position(' ' in m.key) > 0 AND substring(m.key from '[^ ]+$') = ANY($1::text[])
        GROUP BY 1`, surnames)).map(row => [row.last, row.firsts])),

    // How many times the tagger met each of these names (their keys), all kinds together: Map key -> seen. A
    // name it never met is not in it
    seenOf: async (keys) => new Map(keys.length === 0 ? [] : (await prisma.$queryRawUnsafe(`
        SELECT key, sum(seen)::int AS seen FROM mentions WHERE key = ANY($1::text[]) GROUP BY key`, keys))
        .map(row => [row.key, row.seen])),

    // [qid]: the items of Wikidata the names written so (their key, see mentionKey) were linked to
    qidsOfKey: async (key) => (await prisma.$queryRawUnsafe(`
        SELECT DISTINCT qid FROM mentions WHERE key = $1 AND qid IS NOT NULL`, key)).map(row => row.qid),

    // [{id_story, ids}]: the news of these stories, as they are now
    articlesOfStories: async (storyIds) => storyIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT id_story, array_agg(id) AS ids FROM articles WHERE id_story = ANY($1::int[]) GROUP BY id_story`, storyIds),

    // [{qid, country, international, bodies, media}]: the countries of these items already read
    // (db/add_item_countries.sql), country null for an item that has none; media null for one read
    // before db/add_item_media.sql, and absent while that migration is not applied (the rows are then
    // taken as read: the countries are those of before)
    countriesOf: async (qids) => qids.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT qid, country, international, bodies${await hasMediaColumn() ? ', media' : ''} FROM item_countries WHERE qid = ANY($1::text[])`, qids),

    // [qid]: the items names were linked to whose country was never read, or before their bodies were
    // (db/add_item_bodies.sql), of the most met names first
    toLocate: async (limit) => (await prisma.$queryRawUnsafe(`
        SELECT m.qid FROM mentions m
        WHERE m.qid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_countries c WHERE c.qid = m.qid AND c.bodies IS NOT NULL)
        GROUP BY m.qid ORDER BY max(m.seen) DESC LIMIT $1`, limit)).map(row => row.qid),

    // countries: [{qid, country, international, bodies, media}] read from Wikidata, kept
    saveCountries: async (countries) => {
        if (countries.length === 0) return 0;
        const withMedia = await hasMediaColumn();
        return prisma.$executeRawUnsafe(`
        INSERT INTO item_countries (qid, country, international, bodies${withMedia ? ', media' : ''})
        SELECT qid, country, international, COALESCE(bodies, '{}')${withMedia ? ', COALESCE(media, false)' : ''}
        FROM jsonb_to_recordset($1::jsonb) AS x(qid text, country text, international boolean, bodies text[], media boolean)
        ON CONFLICT (qid) DO UPDATE SET country = EXCLUDED.country, international = EXCLUDED.international,
            bodies = EXCLUDED.bodies, ${withMedia ? 'media = EXCLUDED.media, ' : ''}looked_at = now()`,
        JSON.stringify(countries.map(({qid, country, international, bodies, media}) => ({qid, country, international, bodies, media}))));
    },

    // the names no news names any more, never looked for in Wikidata: the item of the others is kept on
    // purpose (the user, 17.10.2026), so a name that comes back is not looked for again in Wikidata,
    // which limits its calls; the linked ones are never deleted
    deleteUnused: async () => prisma.$executeRawUnsafe(`
        DELETE FROM mentions m WHERE m.linked_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM article_mentions am WHERE am.id_mention = m.id)`),
};
