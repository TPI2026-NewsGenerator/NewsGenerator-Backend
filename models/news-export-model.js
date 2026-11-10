//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: news-export-model.js
//  Description: The news kept that name a person and/or an association, for the system of another party that reads them
//               through /api/v1/news (see news-export-service.js). The person is found by the item of Wikidata the tagger
//               linked (all scripts) and by words in the title and the description (the scripts the index of trigrams
//               serves); the association by the item of Wikidata its news name
//

"use strict"

import {prisma} from '../config/db.js';

// the columns of an article as the route gives them; the time it was seen with its microseconds, the cursor must not skip or repeat a row
const SEEN = `to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const NewsExportModel = {
    // filters: {persons: [qid], terms: [a regex of Postgres a word], associations: [qid], langs, media, excludedMedia, since, until, hasText,
    // dedupe: 'story'|null, order: 'asc'|'desc', after: {seen, id}|null, limit}. The persons and the terms are one set (the
    // news about the person, either way), the associations another: a news must be in each set that is asked. One row more than the
    // limit, to tell whether there is a next page
    find: async (filters) => {
        const params = [];
        const p = (value) => { params.push(value); return `$${params.length}`; };
        const ascending = filters.order !== 'desc';
        const afterSeen = filters.after ? p(filters.after.seen) : null;

        const sets = [];
        const aboutPerson = [];
        if (filters.persons.length > 0) {
            aboutPerson.push(`SELECT am.id_article AS id FROM article_mentions am JOIN mentions m ON m.id = am.id_mention WHERE m.qid = ANY(${p(filters.persons)}::text[])`);
        }
        // One search a word, joined: the seven words of the name of Infantino in five scripts in ONE regex took 8 s (the index of
        // trigrams is no use to a long alternation), each of them alone 0.0 to 0.6 s (10.11.2026). The pages after the first only read
        // what came after the cursor
        for (const regex of filters.terms) {
            aboutPerson.push(`SELECT t.id FROM articles t WHERE t.search_text ~* ${p(regex)}${afterSeen ? ` AND t.created_at ${ascending ? '>=' : '<='} ${afterSeen}::timestamptz` : ''}`);
        }
        // The words of a script the index does not serve (Chinese, Japanese, Korean...: 40 s over every news) are read only in the news of the
        // associations asked, a few hundred: the name of Infantino in katakana, in the Japanese news that name the Japan FA
        if (filters.associations.length > 0) {
            for (const regex of filters.scanTerms) {
                aboutPerson.push(`SELECT t.id FROM articles t WHERE t.id IN (SELECT am.id_article FROM article_mentions am JOIN mentions m ON m.id = am.id_mention WHERE m.qid = ANY(${p(filters.associations)}::text[])) AND t.search_text ~* ${p(regex)}`);
            }
        }
        if (aboutPerson.length > 0) sets.push(`a.id IN (${aboutPerson.join(' UNION ')})`);
        if (filters.associations.length > 0) {
            sets.push(`a.id IN (SELECT am.id_article FROM article_mentions am JOIN mentions m ON m.id = am.id_mention WHERE m.qid = ANY(${p(filters.associations)}::text[]))`);
        }
        if (filters.langs.length > 0) sets.push(`a.lang = ANY(${p(filters.langs)}::text[])`);
        if (filters.media.length > 0) sets.push(`medium_of(a.link) = ANY(${p(filters.media)}::text[])`);
        if (filters.excludedMedia.length > 0) sets.push(`COALESCE(medium_of(a.link), '') <> ALL(${p(filters.excludedMedia)}::text[])`);
        if (filters.since) sets.push(`COALESCE(a.published_at, a.created_at) >= ${p(filters.since)}::timestamptz`);
        if (filters.until) sets.push(`COALESCE(a.published_at, a.created_at) < ${p(filters.until)}::timestamptz`);
        if (filters.hasText) sets.push(`length(btrim(a.description)) >= 40`);

        const direction = ascending ? 'ASC' : 'DESC';
        const after = filters.after
            ? `WHERE (r.created_at, r.id) ${ascending ? '>' : '<'} (${afterSeen}::timestamptz, ${p(filters.after.id)}::int)`
            : '';
        // one article of each story, the one with the most text (then the first told): the others are the same news in another medium, often
        // a title alone (Google News). The one kept can change when a longer one joins the story: for browsing, not for following
        const base = `SELECT a.id, a.link, a.title, a.description, a.lang, a.published_at, a.created_at, a.id_story, medium_of(a.link) AS medium, ${SEEN} AS seen
            FROM articles a WHERE ${sets.join(' AND ')}`;
        const rows = filters.dedupe === 'story'
            ? `(SELECT DISTINCT ON (COALESCE(b.id_story::text, 'a' || b.id::text)) b.* FROM (${base}) b
                ORDER BY COALESCE(b.id_story::text, 'a' || b.id::text), length(btrim(b.description)) DESC, b.created_at ASC, b.id ASC) r`
            : `(${base}) r`;
        return prisma.$queryRawUnsafe(
            `SELECT r.* FROM ${rows} ${after} ORDER BY r.created_at ${direction}, r.id ${direction} LIMIT ${p(filters.limit + 1)}::int`, ...params);
    },

    // how big each story is: its articles and the media that told it, {id, size, media}
    storiesOf: async (ids) => ids.length === 0 ? [] : prisma.$queryRawUnsafe(
        `SELECT id_story AS id, count(*)::int AS size, count(DISTINCT medium_of(link))::int AS media
         FROM articles WHERE id_story = ANY($1::int[]) GROUP BY id_story`, ids),

    // the names the tagger found in these articles, [{id, name, kind, qid}]
    entitiesOf: async (ids) => ids.length === 0 ? [] : prisma.$queryRawUnsafe(
        `SELECT am.id_article AS id, m.name, m.kind, m.qid FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
         WHERE am.id_article = ANY($1::int[]) ORDER BY am.id_article, m.seen DESC`, ids),

    // which of these items of Wikidata each article names, [{id, qid}]: why an article was found
    linkedAmong: async (ids, qids) => ids.length === 0 || qids.length === 0 ? [] : prisma.$queryRawUnsafe(
        `SELECT DISTINCT am.id_article AS id, m.qid FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
         WHERE am.id_article = ANY($1::int[]) AND m.qid = ANY($2::text[])`, ids, qids),
};
