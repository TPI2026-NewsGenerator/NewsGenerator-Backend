//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: briefing-export-model.js
//  Description: The cards the briefings of ALL the readers chose, as GET /api/v1/briefing/news gives them to the system of another party (see
//               briefing-export-service.js). Read only, from the ready briefings (briefings.items): nothing is written, no migration. The card is
//               read as it was chosen; who it was chosen for is only counted here (briefings, readers), never named
//
//  Not the cards a reader added by hand (a negative storyId: a link they pasted, which may be a private page), and the briefings still
//  running or failed
//

"use strict"

import {prisma} from '../config/db.js';

// How far back the briefings are read: the stories live 30 days (FEED_RETENTION_DAYS), a card older than this has no article left in the base
export const HISTORY_DAYS = 45;
// A briefing is given a few seconds after it is ready, not at the instant: two that finish together are committed in any order, and a client
// that goes on from the time of the first one would never see the other
const SETTLE_SECONDS = 5;

// the moment a briefing was ready, with its microseconds: the cursor must not skip or repeat a card
const SEEN = `to_char(c.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const BriefingExportModel = {
    // filters: {since, until, topics: [..], dedupe: 'story'|'none', order: 'asc'|'desc', after: {seen, briefing, position}|null, limit}. topics: the topic the card was given
    // (politics, sport...), none for every topic.
    // dedupe 'story': a story once, at the first briefing that chose it (the other party judges a news once, not once per reader); 'none': every choice.
    // The cursor is (the time the briefing was ready, the briefing, the place of the card in it). One row more than the limit, to tell whether there is a next page.
    // [{briefing, position, card, story, seen, readers}]
    find: async (filters) => {
        const params = [];
        const p = (value) => { params.push(value); return `$${params.length}`; };
        const ascending = filters.order !== 'desc';
        const sets = [];
        if (filters.since) sets.push(`c.finished_at >= ${p(filters.since)}::timestamptz`);
        if (filters.until) sets.push(`c.finished_at < ${p(filters.until)}::timestamptz`);
        if (filters.topics.length > 0) sets.push(`c.card->>'topic' = ANY(${p(filters.topics)}::text[])`);
        if (filters.after) {
            sets.push(`(c.finished_at, c.briefing, c.position) ${ascending ? '>' : '<'} (${p(filters.after.seen)}::timestamptz, ${p(filters.after.briefing)}::int, ${p(filters.after.position)}::int)`);
        }
        const direction = ascending ? 'ASC' : 'DESC';
        const chosen = filters.dedupe === 'none'
            ? 'SELECT * FROM selected'
            : 'SELECT DISTINCT ON (story) * FROM selected ORDER BY story, finished_at, briefing, position';
        return prisma.$queryRawUnsafe(`
            WITH raw AS (
                SELECT b.id AS briefing, b.id_user AS reader, b.finished_at, t.position::int AS position, t.card,
                       CASE WHEN jsonb_typeof(t.card->'storyId') = 'number' THEN (t.card->>'storyId')::int END AS story
                FROM briefings b
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(card, position)
                WHERE b.status = 'ready' AND b.finished_at >= now() - make_interval(days => ${HISTORY_DAYS})
                  AND b.finished_at < now() - make_interval(secs => ${SETTLE_SECONDS})
            ), selected AS (
                SELECT * FROM raw WHERE story > 0
            ), stats AS (
                SELECT story, count(DISTINCT reader)::int AS readers FROM selected GROUP BY story
            ), c AS (${chosen})
            SELECT c.briefing, c.position, c.card, c.story, ${SEEN} AS seen, stats.readers
            FROM c JOIN stats USING (story)
            ${sets.length > 0 ? `WHERE ${sets.join(' AND ')}` : ''}
            ORDER BY c.finished_at ${direction}, c.briefing ${direction}, c.position ${direction} LIMIT ${p(filters.limit + 1)}::int`, ...params);
    },
};
