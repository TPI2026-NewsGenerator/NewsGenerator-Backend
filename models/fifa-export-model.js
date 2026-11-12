//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-export-model.js
//  Description: The passages of the news that the map "The FIFA presidency" selected, as GET /api/v1/fifa/news gives them to the system of another
//               party (see fifa-export-service.js). Read only, from fifa_signals (db/add_fifa_map.sql): the passages are copied there whole,
//               so they outlive the 30 days the news are kept
//

"use strict"

import {prisma} from '../config/db.js';

// the moment a signal last changed, with its microseconds: the cursor must not skip or repeat a row (as news-export-model.js)
const SEEN = `to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const FifaExportModel = {
    // filters: {certainty: [..], subjects: [qid], members: [qid], since, until, order: 'asc'|'desc', after: {seen, id}|null, limit}. Only the passages whose
    // reading is settled (a second reading that failed is made again later: the passage then changes, and comes again). The news date (since, until)
    // is the one of the article; the cursor goes on from the moment the signal last changed. One row more than the limit, to tell whether there is a next page
    find: async (filters) => {
        const params = [];
        const p = (value) => { params.push(value); return `$${params.length}`; };
        const ascending = filters.order !== 'desc';
        const sets = ['s.confirmed', `s.certainty = ANY(${p(filters.certainty)}::text[])`];
        if (filters.subjects.length > 0) sets.push(`s.subject_qid = ANY(${p(filters.subjects)}::text[])`);
        if (filters.members.length > 0) sets.push(`s.member_qid = ANY(${p(filters.members)}::text[])`);
        if (filters.since) sets.push(`s.published_at >= ${p(filters.since)}::timestamptz`);
        if (filters.until) sets.push(`s.published_at < ${p(filters.until)}::timestamptz`);
        if (filters.after) sets.push(`(s.updated_at, s.id) ${ascending ? '>' : '<'} (${p(filters.after.seen)}::timestamptz, ${p(filters.after.id)}::int)`);
        const direction = ascending ? 'ASC' : 'DESC';
        return prisma.$queryRawUnsafe(`
            SELECT s.id, s.subject_qid, j.name AS subject_name, s.member_qid, s.certainty, s.uncertain_reason, s.stance, s.level, s.mark, s.speaker_kind, s.speaker, s.matched,
                   s.sentence, s.title, s.description, s.quote, s.lang, s.url, s.medium, s.published_at, s.news_count, s.media_count, ${SEEN} AS seen
            FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid
            WHERE ${sets.join(' AND ')}
            ORDER BY s.updated_at ${direction}, s.id ${direction} LIMIT ${p(filters.limit + 1)}::int`, ...params);
    },
};
