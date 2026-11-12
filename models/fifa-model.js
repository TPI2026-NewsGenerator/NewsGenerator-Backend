//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-model.js
//  Description: The candidates, the signals, the votes and the presidents of the map "The FIFA presidency" (db/add_fifa_map.sql), and the news the
//               passages are read from
//

"use strict"

import {prisma} from '../config/db.js';

const SIGNAL = `s.id, s.subject_qid, s.member_qid, s.certainty, s.uncertain_reason, s.stance, s.level, s.mark, s.speaker_kind, s.speaker, s.sentence, s.lang, s.url,
    s.medium, s.published_at, s.news_count, s.media_count, s.confirmed`;
const VOTE = `v.id, v.user_id, u.username, v.subject_qid, v.member_qid, v.value, v.note, v.seen, v.created_at`;

export const FifaModel = {
    // --- the candidates
    subjects: async () => prisma.$queryRawUnsafe(`SELECT qid, name, terms, status, state, color_index, created_at, checked_at, backfilled_at FROM fifa_subjects ORDER BY color_index, created_at`),

    addSubject: async ({qid, name, terms, status, userId}) => prisma.$queryRawUnsafe(`
        INSERT INTO fifa_subjects (qid, name, terms, status, state, color_index, created_by)
        VALUES ($1::text, $2::text, $3::text[], $4::text, 'computing',
            (SELECT COALESCE(MIN(i), 6) FROM generate_series(1, 6) i WHERE i NOT IN (SELECT color_index FROM fifa_subjects)), $5::int)
        ON CONFLICT (qid) DO NOTHING RETURNING qid, name, terms, status, state, color_index`, qid, name, terms, status, userId),

    // an administrator: the status of a candidate (withdrawn, rumoured...), or taking one off the map with all it holds
    setSubjectStatus: async (qid, status) => prisma.$executeRawUnsafe(`UPDATE fifa_subjects SET status = $2::text WHERE qid = $1::text`, qid, status),
    deleteSubject: async (qid) => prisma.$executeRawUnsafe(`DELETE FROM fifa_subjects WHERE qid = $1::text`, qid),

    // the news created since "checkedAt" are the ones read next; state "ready" once the first 30 days were read
    markChecked: async (qid, checkedAt, ready) => prisma.$executeRawUnsafe(`
        UPDATE fifa_subjects SET checked_at = $2::timestamptz, state = CASE WHEN $3::boolean THEN 'ready' ELSE state END,
            backfilled_at = CASE WHEN $3::boolean AND backfilled_at IS NULL THEN now() ELSE backfilled_at END WHERE qid = $1::text`, qid, checkedAt, ready),

    // --- the news (read only): the ones that name the person since a date, the links the tagger made, the names it linked to the members
    news: async ({regex, since}) => prisma.$queryRawUnsafe(`
        SELECT id, title, description, search_text AS text, lang, medium_of(link) AS medium, id_story AS story, link, COALESCE(published_at, created_at) AS at
        FROM articles WHERE search_text ~* $1::text AND created_at >= $2::timestamptz`, regex, since),

    linkedNames: async (articleIds, qids) => articleIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT am.id_article AS id, m.qid, m.name FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.qid = ANY($2::text[])`, articleIds, qids),

    mentionNames: async (qids) => prisma.$queryRawUnsafe(`SELECT name, qid FROM mentions WHERE qid = ANY($1::text[]) AND kind = 'organization'`, qids),

    // --- the signals
    // the hashes of these passages already read for the candidate
    knownHashes: async (qid, hashes) => hashes.length === 0 ? new Set() : new Set((await prisma.$queryRawUnsafe(
        `SELECT hash FROM fifa_signals WHERE subject_qid = $1::text AND hash = ANY($2::text[])`, qid, hashes)).map(row => row.hash)),

    insertSignal: async (signal) => prisma.$executeRawUnsafe(`
        INSERT INTO fifa_signals (subject_qid, member_qid, hash, certainty, uncertain_reason, stance, level, mark, speaker_kind, speaker, matched, sentence, title, description, quote,
            lang, url, medium, published_at, news_count, media_count, read_by, confirmed)
        VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text, $15::text,
            $16::text, $17::text, $18::text, $19::timestamptz, $20::int, $21::int, $22::text[], $23::boolean)
        ON CONFLICT (subject_qid, member_qid, hash) DO UPDATE SET news_count = GREATEST(fifa_signals.news_count, EXCLUDED.news_count), media_count = GREATEST(fifa_signals.media_count, EXCLUDED.media_count)`,
        signal.subject_qid, signal.member_qid, signal.hash, signal.certainty, signal.uncertain_reason, signal.stance, signal.level, signal.mark, signal.speaker_kind, signal.speaker, signal.matched,
        signal.sentence, signal.title, signal.description, signal.quote, signal.lang, signal.url, signal.medium, signal.published_at, signal.news_count, signal.media_count, signal.read_by, signal.confirmed),

    // the passages whose second reading failed: read again, a few at a time
    unconfirmed: async (limit) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.subject_qid, s.member_qid, s.hash, s.matched, s.sentence, s.title, s.description, s.lang, s.url, s.medium, s.published_at, s.news_count, s.media_count, j.name AS subject_name
        FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid WHERE s.certainty = 'uncertain' AND NOT s.confirmed ORDER BY s.id LIMIT $1::int`, limit),

    updateSignal: async (id, reading) => prisma.$executeRawUnsafe(`
        UPDATE fifa_signals SET certainty = $2::text, uncertain_reason = $3::text, stance = $4::text, level = $5::text, mark = $6::text, speaker_kind = $7::text, speaker = $8::text,
            quote = $9::text, read_by = $10::text[], confirmed = $11::boolean WHERE id = $1::int`,
        id, reading.certainty, reading.uncertain_reason, reading.stance, reading.level, reading.mark, reading.speaker_kind, reading.speaker, reading.quote, reading.read_by, reading.confirmed),

    // the established signals of a FAMILY: the ones whose title, description or sentence match a pattern (a regular expression of Postgres, case ignored),
    // to be read again when a rule of the guide changes (FifaService.reread)
    establishedMatching: async (pattern) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.subject_qid, s.member_qid, s.hash, s.matched, s.sentence, s.title, s.description, s.lang, s.url, s.medium, s.published_at, s.stance, s.level, j.name AS subject_name
        FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid
        WHERE s.certainty = 'established' AND (s.sentence ~* $1::text OR s.title ~* $1::text OR s.description ~* $1::text) ORDER BY s.id`, pattern),

    // every signal the map is made of (the passages left out are in it: they are the count of articles)
    signals: async () => prisma.$queryRawUnsafe(`SELECT ${SIGNAL} FROM fifa_signals s`),
    signalsOf: async (memberQid) => prisma.$queryRawUnsafe(`SELECT ${SIGNAL} FROM fifa_signals s WHERE s.member_qid = $1::text`, memberQid),

    // --- the audit
    // established signals for the audit: the ones of the last days first, then older ones, [{id, ..., recent}]
    auditSample: async ({days}) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.subject_qid, s.member_qid, s.hash, s.matched, s.sentence, s.title, s.description, s.lang, s.url, s.medium, s.published_at, s.stance, s.level,
            j.name AS subject_name, (s.created_at >= now() - make_interval(days => $1::int)) AS recent
        FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid WHERE s.certainty = 'established'`, days),
    lastAudit: async () => (await prisma.$queryRawUnsafe(`SELECT made_at FROM fifa_audits ORDER BY made_at DESC LIMIT 1`))[0] ?? null,
    audits: async (limit) => prisma.$queryRawUnsafe(`SELECT id, made_at, auditor, sampled, agreed, unreadable, votes_total, votes_contradicting, verdict, details FROM fifa_audits ORDER BY made_at DESC LIMIT $1::int`, limit),
    addAudit: async (audit) => prisma.$executeRawUnsafe(`
        INSERT INTO fifa_audits (auditor, sampled, agreed, unreadable, votes_total, votes_contradicting, verdict, details)
        VALUES ($1::text, $2::int, $3::int, $4::int, $5::int, $6::int, $7::text, $8::jsonb)`,
        audit.auditor, audit.sampled, audit.agreed, audit.unreadable, audit.votes_total, audit.votes_contradicting, audit.verdict, JSON.stringify(audit.details)),

    // --- the votes
    votes: async () => prisma.$queryRawUnsafe(`SELECT ${VOTE} FROM fifa_votes v JOIN users u ON u.id = v.user_id ORDER BY v.created_at`),
    votesOf: async (memberQid) => prisma.$queryRawUnsafe(`SELECT ${VOTE} FROM fifa_votes v JOIN users u ON u.id = v.user_id WHERE v.member_qid = $1::text ORDER BY v.created_at`, memberQid),
    votesOfPair: async (subjectQid, memberQid) => prisma.$queryRawUnsafe(
        `SELECT ${VOTE} FROM fifa_votes v JOIN users u ON u.id = v.user_id WHERE v.subject_qid = $1::text AND v.member_qid = $2::text ORDER BY v.created_at`, subjectQid, memberQid),
    addVote: async ({userId, subjectQid, memberQid, value, note, seen = ''}) => prisma.$executeRawUnsafe(
        `INSERT INTO fifa_votes (user_id, subject_qid, member_qid, value, note, seen) VALUES ($1::int, $2::text, $3::text, $4::text, $5::text, $6::text)`, userId, subjectQid, memberQid, value, note, seen),
    // the votes of one choice, all or none: [{subjectQid, memberQid, value}] for a reader
    addVotes: async (userId, votes) => votes.length === 0 ? [] : prisma.$transaction(votes.map(vote => prisma.$executeRawUnsafe(
        `INSERT INTO fifa_votes (user_id, subject_qid, member_qid, value, note, seen) VALUES ($1::int, $2::text, $3::text, $4::text, '', '')`, userId, vote.subjectQid, vote.memberQid, vote.value))),
    deleteVote: async (id) => prisma.$executeRawUnsafe(`DELETE FROM fifa_votes WHERE id = $1::int`, id),

    // --- the presidents
    // What the news of the last 30 days say of each president: [{lid, articles, last_at}] and [{lid, medium, link, title, at}] for the latest one. A president with an item of
    // Wikidata is looked for by it (the tagger linked the name), one without by his name as it is compared (the key of mentions: "philippe diallo"). leaders: [{lid, qid, key}]
    mentionsOfLeaders: async (leaders) => {
        if (leaders.length === 0) return {counts: [], latest: []};
        const params = [leaders.map(l => l.lid), leaders.map(l => l.qid), leaders.map(l => l.key)];
        const HIT = `
            WITH leaders(lid, qid, key) AS (SELECT * FROM unnest($1::int[], $2::text[], $3::text[])),
            hit AS (
                SELECT l.lid, am.id_article FROM leaders l JOIN mentions m ON m.qid = l.qid AND m.kind = 'person' JOIN article_mentions am ON am.id_mention = m.id WHERE l.qid IS NOT NULL
                UNION
                SELECT l.lid, am.id_article FROM leaders l JOIN mentions m ON m.key = l.key AND m.kind = 'person' JOIN article_mentions am ON am.id_mention = m.id WHERE l.qid IS NULL)`;
        const counts = await prisma.$queryRawUnsafe(`${HIT}
            SELECT h.lid, count(*)::int AS articles, max(COALESCE(a.published_at, a.created_at)) AS last_at FROM hit h JOIN articles a ON a.id = h.id_article GROUP BY h.lid`, ...params);
        const latest = await prisma.$queryRawUnsafe(`${HIT}
            SELECT DISTINCT ON (h.lid) h.lid, medium_of(a.link) AS medium, a.link, a.title, COALESCE(a.published_at, a.created_at) AS at
            FROM hit h JOIN articles a ON a.id = h.id_article ORDER BY h.lid, COALESCE(a.published_at, a.created_at) DESC`, ...params);
        return {counts, latest};
    },

    leaders: async () => prisma.$queryRawUnsafe(`SELECT member_qid, person_qid, name, role, since, source, source_url, checked_at FROM fifa_leaders`),
    replaceLeaders: async (leaders) => {
        await prisma.$executeRawUnsafe(`DELETE FROM fifa_leaders`);
        if (leaders.length === 0) return;
        await prisma.$executeRawUnsafe(`
            INSERT INTO fifa_leaders (member_qid, person_qid, name, role, since, source, source_url)
            SELECT x.member_qid, x.person_qid, x.name, x.role, NULLIF(x.since, '')::date, COALESCE(x.source, 'wikidata'), COALESCE(x.source_url, '')
            FROM jsonb_to_recordset($1::jsonb) AS x(member_qid text, person_qid text, name text, role text, since text, source text, source_url text)
            ON CONFLICT (member_qid) DO NOTHING`, JSON.stringify(leaders));
    },
};
