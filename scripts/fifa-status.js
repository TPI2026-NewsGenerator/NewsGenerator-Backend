//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: fifa-status.js
//  Description: Where the map of the FIFA presidency stands (read only, nothing is written): for each candidate whether its news are read ("computing" while the first 30 days are
//               read, then "ready"), how many signals it holds, when the news were last read and how many news wait to be read; the checks of the sources of the readers that
//               wait; the notes; the last audit. The server reads the news every FIFA_WATCH_MINUTES (30 by default): a run that finds nothing says nothing in the log
//
//  node --env-file=.env scripts/fifa-status.js
//

import process from 'node:process';
import {prisma} from '../config/db.js';

const WATCH_MINUTES = Number(process.env.FIFA_WATCH_MINUTES) || 30;
const when = (date) => date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) : '-';
const ago = (date) => {
    if (!date) return '';
    const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60e3);
    return minutes < 90 ? ` (${minutes} min ago)` : ` (${Math.round(minutes / 60)} h ago)`;
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

try {
    const subjects = await prisma.$queryRawUnsafe(`
        SELECT j.qid, j.name, j.terms, j.status, j.state, j.origin, j.created_at, j.backfilled_at, j.checked_at,
            (SELECT count(*)::int FROM fifa_signals s WHERE s.subject_qid = j.qid) AS signals,
            (SELECT count(*)::int FROM fifa_signals s WHERE s.subject_qid = j.qid AND s.certainty = 'established') AS established,
            (SELECT count(*)::int FROM fifa_signals s WHERE s.subject_qid = j.qid AND s.certainty = 'uncertain') AS uncertain,
            (SELECT count(*)::int FROM fifa_signals s WHERE s.subject_qid = j.qid AND s.certainty = 'uncertain' AND NOT s.confirmed) AS unconfirmed,
            (SELECT max(s.created_at) FROM fifa_signals s WHERE s.subject_qid = j.qid) AS last_signal
        FROM fifa_subjects j ORDER BY j.color_index`);
    console.log(`The map of the FIFA presidency, ${when(new Date())} UTC. The news are read every ${WATCH_MINUTES} minutes while the server runs.\n`);
    for (const one of subjects) {
        const waiting = one.checked_at && one.terms?.length
            ? (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM articles WHERE created_at >= $2::timestamptz AND search_text ~* $1::text`, `(${one.terms.map(escapeRegex).join('|')})`, one.checked_at))[0].n
            : null;
        const reading = one.state === 'computing' ? 'READING the first 30 days of news' : 'ready';
        console.log(`${one.name} (${one.origin}, ${one.status}): ${reading}`);
        console.log(`   added ${when(one.created_at)} | first reading ended ${when(one.backfilled_at)} | news last looked at ${when(one.checked_at)}${ago(one.checked_at)}`);
        console.log(`   ${one.signals} signals: ${one.established} established, ${one.uncertain} uncertain (${one.unconfirmed} waiting for their second reading), the last one kept ${when(one.last_signal)}${ago(one.last_signal)}`);
        if (waiting !== null) console.log(`   ${waiting} news that name him arrived since and wait for the next run`);
    }
    const [more] = await prisma.$queryRawUnsafe(`
        SELECT (SELECT count(*)::int FROM fifa_votes WHERE source_check = 'pending') AS votes_pending,
               (SELECT count(*)::int FROM fifa_votes WHERE source_url <> '') AS votes_with_source,
               (SELECT count(*)::int FROM fifa_sources WHERE state = 'pending') AS pages_pending,
               (SELECT count(*)::int FROM fifa_sources) AS pages,
               (SELECT count(*)::int FROM fifa_notes) AS notes,
               (SELECT count(*)::int FROM fifa_leaders) AS leaders,
               (SELECT max(checked_at) FROM fifa_leaders) AS leaders_checked`);
    console.log(`\nSources of the readers: ${more.votes_with_source} joined to a choice (${more.votes_pending} waiting to be read), ${more.pages} added on their own (${more.pages_pending} waiting to be read). Notes: ${more.notes}.`);
    console.log(`Presidents: ${more.leaders} known, renewed ${when(more.leaders_checked)}${ago(more.leaders_checked)}.`);
    const [audit] = await prisma.$queryRawUnsafe(`SELECT made_at, verdict, sampled, agreed FROM fifa_audits ORDER BY made_at DESC LIMIT 1`);
    console.log(audit ? `Last audit: ${when(audit.made_at)}${ago(audit.made_at)}, ${audit.verdict} (${audit.agreed} of ${audit.sampled} agree).` : 'No audit yet (the first one is made a week after the server starts).');
    console.log('\nThe log of the server (a run that finds nothing says nothing):  ssh fabich@192.168.1.135 "docker logs --since 2h newsgenerator-api 2>&1 | grep \'FIFA map\'"');
} finally {
    await prisma.$disconnect();
}
