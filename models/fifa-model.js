//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-model.js
//  Description: The candidates, the signals, the votes and the presidents of the map "The FIFA presidency" (db/add_fifa_map.sql), and the news the
//               passages are read from
//

"use strict"

import {prisma} from '../config/db.js';
import {DISCOVERY_REGEX} from '../services/utils/fifa-discovery.js';

const SIGNAL = `s.id, s.subject_qid, s.member_qid, s.certainty, s.uncertain_reason, s.stance, s.level, s.mark, s.speaker_kind, s.speaker, s.sentence, s.lang, s.url,
    s.medium, s.published_at, s.news_count, s.media_count, s.confirmed`;
const VOTE = `v.id, v.user_id, u.username, v.subject_qid, v.member_qid, v.value, v.note, v.seen, v.created_at, v.source_url, v.source_medium, v.source_check, v.source_found, v.source_checked_at`;
// one vote written, with its source when the reader joined one (checked later: "pending"); answers the id
const INSERT_VOTE = `INSERT INTO fifa_votes (user_id, subject_qid, member_qid, value, note, seen, source_url, source_medium, source_check)
    VALUES ($1::int, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text) RETURNING id`;
const voteArguments = (userId, vote) => [userId, vote.subjectQid, vote.memberQid, vote.value, vote.note ?? '', vote.seen ?? '', vote.source?.url ?? '', vote.source?.medium ?? '', vote.source ? 'pending' : ''];

export const FifaModel = {
    // --- the candidates
    subjects: async () => prisma.$queryRawUnsafe(`SELECT qid, name, terms, status, state, color_index, origin, found, created_at, checked_at, backfilled_at FROM fifa_subjects ORDER BY color_index, created_at`),

    // origin: reader | news (found: what the news said, for a candidate they brought; userId null for the news)
    addSubject: async ({qid, name, terms, status, userId, origin = 'reader', found = null}) => prisma.$queryRawUnsafe(`
        INSERT INTO fifa_subjects (qid, name, terms, status, state, color_index, created_by, origin, found)
        VALUES ($1::text, $2::text, $3::text[], $4::text, 'computing',
            (SELECT COALESCE(MIN(i), 6) FROM generate_series(1, 6) i WHERE i NOT IN (SELECT color_index FROM fifa_subjects)), $5::int, $6::text, $7::jsonb)
        ON CONFLICT (qid) DO NOTHING RETURNING qid, name, terms, status, state, color_index, origin, found`, qid, name, terms, status, userId ?? null, origin, found ? JSON.stringify(found) : null),

    // the candidates an administrator took off the map: the news do not bring them back
    dismissed: async () => new Set((await prisma.$queryRawUnsafe(`SELECT qid FROM fifa_dismissed`)).map(row => row.qid)),
    dismiss: async (qid) => prisma.$executeRawUnsafe(`INSERT INTO fifa_dismissed (qid) VALUES ($1::text) ON CONFLICT (qid) DO NOTHING`, qid),

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

    // the news since a date that hold FIFA, a word of president and a word of candidacy (the three stems of fifa-discovery.js), and the persons the tagger linked in them
    discoveryNews: async ({since}) => prisma.$queryRawUnsafe(`
        SELECT id, title, description, search_text AS text, lang, medium_of(link) AS medium, link, COALESCE(published_at, created_at) AS at
        FROM articles WHERE created_at >= $1::timestamptz AND search_text ~* $2::text AND search_text ~* $3::text AND search_text ~* $4::text`,
        since, DISCOVERY_REGEX.fifa, DISCOVERY_REGEX.president, DISCOVERY_REGEX.candidacy),
    personsOfArticles: async (articleIds) => articleIds.length === 0 ? [] : prisma.$queryRawUnsafe(`
        SELECT am.id_article AS id, m.qid, m.name FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
        WHERE am.id_article = ANY($1::int[]) AND m.kind = 'person' AND m.qid IS NOT NULL`, articleIds),

    mentionNames: async (qids) => prisma.$queryRawUnsafe(`SELECT name, qid FROM mentions WHERE qid = ANY($1::text[]) AND kind = 'organization'`, qids),

    // --- the signals
    // the hashes of these passages already read for the candidate
    knownHashes: async (qid, hashes) => hashes.length === 0 ? new Set() : new Set((await prisma.$queryRawUnsafe(
        `SELECT hash FROM fifa_signals WHERE subject_qid = $1::text AND hash = ANY($2::text[])`, qid, hashes)).map(row => row.hash)),

    insertSignal: async (signal) => prisma.$executeRawUnsafe(`
        INSERT INTO fifa_signals (subject_qid, member_qid, hash, certainty, uncertain_reason, stance, level, mark, speaker_kind, speaker, matched, sentence, title, description, quote,
            lang, url, medium, published_at, news_count, media_count, read_by, confirmed, source_id)
        VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text, $15::text,
            $16::text, $17::text, $18::text, $19::timestamptz, $20::int, $21::int, $22::text[], $23::boolean, $24::int)
        ON CONFLICT (subject_qid, member_qid, hash) DO UPDATE SET news_count = GREATEST(fifa_signals.news_count, EXCLUDED.news_count), media_count = GREATEST(fifa_signals.media_count, EXCLUDED.media_count),
            updated_at = CASE WHEN EXCLUDED.news_count > fifa_signals.news_count OR EXCLUDED.media_count > fifa_signals.media_count THEN now() ELSE fifa_signals.updated_at END`,
        signal.subject_qid, signal.member_qid, signal.hash, signal.certainty, signal.uncertain_reason, signal.stance, signal.level, signal.mark, signal.speaker_kind, signal.speaker, signal.matched,
        signal.sentence, signal.title, signal.description, signal.quote, signal.lang, signal.url, signal.medium, signal.published_at, signal.news_count, signal.media_count, signal.read_by, signal.confirmed, signal.source_id ?? null),

    // the passages whose second reading failed: read again, a few at a time
    unconfirmed: async (limit) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.subject_qid, s.member_qid, s.hash, s.matched, s.sentence, s.title, s.description, s.lang, s.url, s.medium, s.published_at, s.news_count, s.media_count, j.name AS subject_name
        FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid WHERE s.certainty = 'uncertain' AND NOT s.confirmed ORDER BY s.id LIMIT $1::int`, limit),

    updateSignal: async (id, reading) => prisma.$executeRawUnsafe(`
        UPDATE fifa_signals SET certainty = $2::text, uncertain_reason = $3::text, stance = $4::text, level = $5::text, mark = $6::text, speaker_kind = $7::text, speaker = $8::text,
            quote = $9::text, read_by = $10::text[], confirmed = $11::boolean, updated_at = now() WHERE id = $1::int`,
        id, reading.certainty, reading.uncertain_reason, reading.stance, reading.level, reading.mark, reading.speaker_kind, reading.speaker, reading.quote, reading.read_by, reading.confirmed),

    // the established signals of a FAMILY: the ones whose title, description or sentence match a pattern (a regular expression of Postgres, case ignored),
    // to be read again when a rule of the guide changes (FifaService.reread)
    establishedMatching: async (pattern) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.subject_qid, s.member_qid, s.hash, s.matched, s.sentence, s.title, s.description, s.lang, s.url, s.medium, s.published_at, s.stance, s.level, j.name AS subject_name
        FROM fifa_signals s JOIN fifa_subjects j ON j.qid = s.subject_qid
        WHERE s.certainty = 'established' AND (s.sentence ~* $1::text OR s.title ~* $1::text OR s.description ~* $1::text) ORDER BY s.id`, pattern),

    // every signal the map is made of (the passages left out are in it: they are the count of articles)
    // source_id, added_by: the signal comes from a page a reader added on its own (and who), not from the news
    signals: async () => prisma.$queryRawUnsafe(`SELECT ${SIGNAL}, s.source_id, u.username AS added_by FROM fifa_signals s
        LEFT JOIN fifa_sources fs ON fs.id = s.source_id LEFT JOIN users u ON u.id = fs.user_id`),
    signalsOf: async (memberQid) => prisma.$queryRawUnsafe(`SELECT ${SIGNAL}, s.source_id, u.username AS added_by FROM fifa_signals s
        LEFT JOIN fifa_sources fs ON fs.id = s.source_id LEFT JOIN users u ON u.id = fs.user_id WHERE s.member_qid = $1::text`, memberQid),

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
    // {userId, subjectQid, memberQid, value, note?, seen?, source?: {url, medium}} -> [{id}]
    addVote: async (vote) => prisma.$queryRawUnsafe(INSERT_VOTE, ...voteArguments(vote.userId, vote)),
    // the votes of one choice, all or none: [{subjectQid, memberQid, value, note?, source?}] for a reader -> one [{id}] for each, in order
    addVotes: async (userId, votes) => votes.length === 0 ? [] : prisma.$transaction(votes.map(vote => prisma.$queryRawUnsafe(INSERT_VOTE, ...voteArguments(userId, vote)))),
    deleteVote: async (id) => prisma.$executeRawUnsafe(`DELETE FROM fifa_votes WHERE id = $1::int`, id),

    // --- the notes of the readers on an association
    notesOf: async (memberQid) => prisma.$queryRawUnsafe(`
        SELECT n.id, n.user_id, u.username, n.text, n.created_at FROM fifa_notes n JOIN users u ON u.id = n.user_id WHERE n.member_qid = $1::text ORDER BY n.created_at DESC, n.id DESC`, memberQid),
    addNote: async ({userId, memberQid, text}) => (await prisma.$queryRawUnsafe(`
        WITH added AS (INSERT INTO fifa_notes (user_id, member_qid, text) VALUES ($1::int, $2::text, $3::text) RETURNING id, user_id, text, created_at)
        SELECT a.id, a.user_id, u.username, a.text, a.created_at FROM added a JOIN users u ON u.id = a.user_id`, userId, memberQid, text))[0],
    noteById: async (id) => (await prisma.$queryRawUnsafe(`SELECT id, user_id FROM fifa_notes WHERE id = $1::int`, id))[0] ?? null,
    deleteNote: async (id) => prisma.$executeRawUnsafe(`DELETE FROM fifa_notes WHERE id = $1::int`, id),

    // --- the sources the readers join to their choice
    voteById: async (id) => (await prisma.$queryRawUnsafe(`SELECT id, user_id, subject_qid, member_qid, value, source_url FROM fifa_votes WHERE id = $1::int`, id))[0] ?? null,
    setSourceCheck: async (id, {check, found = ''}) => prisma.$executeRawUnsafe(
        `UPDATE fifa_votes SET source_check = $2::text, source_found = $3::text, source_checked_at = now() WHERE id = $1::int AND source_url <> ''`, id, check, found),
    // the checks still to make: the ones of the last day that nobody is making now (a check starts the minute the source is added: a few minutes later it is the watch's)
    pendingSources: async (limit) => prisma.$queryRawUnsafe(`
        SELECT id FROM fifa_votes WHERE source_check = 'pending' AND created_at < now() - interval '3 minutes' AND created_at >= now() - interval '1 day' ORDER BY id LIMIT $1::int`, limit),
    // a check that waited a day (the AI never answered) is told as unreadable
    expireSources: async () => prisma.$executeRawUnsafe(`
        UPDATE fifa_votes SET source_check = 'unreadable', source_checked_at = now() WHERE source_check = 'pending' AND created_at < now() - interval '1 day'`),
    // the sources a reader added in the last hours, joined to a choice or on their own
    sourcesSince: async (userId, hours = 24) => (await prisma.$queryRawUnsafe(`
        SELECT (SELECT count(*) FROM fifa_votes WHERE user_id = $1::int AND source_url <> '' AND created_at >= now() - make_interval(hours => $2::int))::int
             + (SELECT count(*) FROM fifa_sources WHERE user_id = $1::int AND created_at >= now() - make_interval(hours => $2::int))::int AS n`, userId, hours))[0].n,

    // --- the sources a reader adds on their own, with no candidate. The same page added again by the same reader for the same association changes the word only
    addSource: async ({userId, memberQid, url, medium, note}) => (await prisma.$queryRawUnsafe(`
        WITH added AS (
            INSERT INTO fifa_sources (user_id, member_qid, url, medium, note) VALUES ($1::int, $2::text, $3::text, $4::text, $5::text)
            ON CONFLICT (user_id, member_qid, url) DO UPDATE SET note = EXCLUDED.note
            RETURNING id, user_id, member_qid, url, medium, note, state, readings, checked_at, created_at)
        SELECT a.*, u.username FROM added a JOIN users u ON u.id = a.user_id`, userId, memberQid, url, medium, note))[0],
    pagesOf: async (memberQid) => prisma.$queryRawUnsafe(`
        SELECT s.id, s.user_id, u.username, s.url, s.medium, s.note, s.state, s.readings, s.checked_at, s.created_at
        FROM fifa_sources s JOIN users u ON u.id = s.user_id WHERE s.member_qid = $1::text ORDER BY s.created_at DESC, s.id DESC`, memberQid),
    sourceById: async (id) => (await prisma.$queryRawUnsafe(`SELECT id, user_id, member_qid, url, state FROM fifa_sources WHERE id = $1::int`, id))[0] ?? null,
    setPageCheck: async (id, {state, readings = []}) => prisma.$executeRawUnsafe(
        `UPDATE fifa_sources SET state = $2::text, readings = $3::jsonb, checked_at = now() WHERE id = $1::int`, id, state, JSON.stringify(readings)),
    pendingPages: async (limit) => prisma.$queryRawUnsafe(`
        SELECT id FROM fifa_sources WHERE state = 'pending' AND created_at < now() - interval '3 minutes' AND created_at >= now() - interval '1 day' ORDER BY id LIMIT $1::int`, limit),
    expirePages: async () => prisma.$executeRawUnsafe(`
        UPDATE fifa_sources SET state = 'unreadable', checked_at = now() WHERE state = 'pending' AND created_at < now() - interval '1 day'`),
    deletePage: async (id) => prisma.$executeRawUnsafe(`DELETE FROM fifa_sources WHERE id = $1::int`, id),

    // --- the presidents
    // What the news of the last 30 days say of each president: [{lid, articles, last_at}] (the articles of the last 30 days only) and [{lid, medium, link, title, at}] for the
    // latest one, however old it is (a president not named for two months still shows when he was last). A president with an item of
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
            SELECT h.lid, count(*)::int AS articles, max(COALESCE(a.published_at, a.created_at)) AS last_at FROM hit h JOIN articles a ON a.id = h.id_article
            WHERE COALESCE(a.published_at, a.created_at) >= now() - interval '30 days' GROUP BY h.lid`, ...params);
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
