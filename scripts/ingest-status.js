//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: ingest-status.js
//  Description: Where the background work stands: the news of the window with their vectors, those
//               still waiting, the pace of the last minutes and the time left at that pace
//
//  node scripts/ingest-status.js       (pnpm run ingest:status)
//

import 'dotenv/config';
import process from 'node:process';
import {prisma} from '../config/db.js';
import {WINDOW_HOURS} from '../services/ingest-service.js';
import {RETENTION_DAYS} from '../services/feed-service.js';

const PACE_MINUTES = 15;    // the pace is measured on the news embedded in these last minutes

const [status] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS news,
           count(*) FILTER (WHERE embedded_at IS NOT NULL)::int AS embedded,
           count(*) FILTER (WHERE embedded_at IS NULL)::int AS pending,
           count(*) FILTER (WHERE id_story IS NOT NULL)::int AS grouped,
           count(*) FILTER (WHERE embedded_at > now() - make_interval(mins => $2::int))::int AS recent,
           max(embedded_at) AS last
    FROM articles
    WHERE COALESCE(published_at, created_at) >= now() - make_interval(hours => $1::int)`,
    WINDOW_HOURS, PACE_MINUTES);

// the older news kept, embedded after the window for the search by meaning (not grouped)
const [older] = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS news, count(*) FILTER (WHERE embedded_at IS NULL)::int AS pending
    FROM articles
    WHERE COALESCE(published_at, created_at) < now() - make_interval(hours => $1::int)
      AND COALESCE(published_at, created_at) >= now() - make_interval(days => $2::int)`,
    WINDOW_HOURS, RETENTION_DAYS);

const percent = status.news > 0 ? Math.round(100 * status.embedded / status.news) : 100;
const perMinute = status.recent / PACE_MINUTES;
const left = perMinute > 0 ? Math.round(status.pending / perMinute) : null;
const time = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`;

console.log(`News of the last ${WINDOW_HOURS} h: ${status.news}`);
console.log(`  with vectors:  ${status.embedded} (${percent}%), in a story: ${status.grouped}`);
console.log(`  waiting:       ${status.pending}`);
console.log(`  last saved:    ${status.last ? status.last.toLocaleString('fr-CH') : 'never'}`);
console.log(`  pace:          ${perMinute.toFixed(1)} news/min over the last ${PACE_MINUTES} min`);
console.log(`  time left:     ${status.pending === 0 ? 'none' : left === null ? `unknown, nothing saved in the last ${PACE_MINUTES} min (a batch is ${process.env.INGEST_MAX_EMBEDDED || 300} news)` : `about ${time(left)} at this pace`}`);

console.log(`Older news of the ${RETENTION_DAYS} days kept: ${older.news}, waiting for vectors: ${older.pending}` +
    (older.pending > 0 ? ` (${process.env.INGEST_OLDER_BATCHES || 1} batch of ${process.env.INGEST_MAX_EMBEDDED || 300} per run, after the window)` : ''));

await prisma.$disconnect();
