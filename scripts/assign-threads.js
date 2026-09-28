//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: assign-threads.js
//  Description: Gives a thread to the stories grouped before the threads existed (db/add_threads.sql),
//               once, in the order of their news, as the background work would have done it
//
//  node scripts/assign-threads.js      (the server may run: the lock of the background work is taken)
//

import 'dotenv/config';
import process from 'node:process';
import pg from 'pg';
import {prisma} from '../config/db.js';
import {threadPending} from '../services/ingest-service.js';

const STEP_MINUTES = 20;    // one pass of the background work

// the lock of the background work (LOCK_KEY in ingest-service.js), waited for and kept to the end: the two
// must not judge the stories at the same time (a pass of the server meanwhile is skipped, the next one
// reads what it missed). About ten minutes for a week of stories
const LOCK_KEY = 'newsgenerator-ingest';
const lock = new pg.Client({connectionString: process.env.DATABASE_URL});
await lock.connect();
await lock.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);

try {
    const [{first, last, waiting}] = await prisma.$queryRawUnsafe(`
        SELECT min(updated_at) AS first, max(updated_at) AS last, count(*)::int AS waiting
        FROM stories WHERE grouped_at IS NULL`);
    console.log(`${waiting} stories without thread${waiting ? `, ${first.toISOString()} to ${last.toISOString()}` : ''}`);

    let total = {touched: 0, created: 0, merged: 0};
    const started = Date.now();
    // slice by slice of their newest news, each slice judged as one pass would have judged it
    for (let from = first; waiting && from <= last; from = new Date(from.getTime() + STEP_MINUTES * 60e3)) {
        const to = new Date(from.getTime() + STEP_MINUTES * 60e3);
        await prisma.$executeRawUnsafe(`
            UPDATE stories SET grouped_at = now()
            WHERE grouped_at IS NULL AND updated_at >= $1::timestamptz AND updated_at < $2::timestamptz`, from, to);
        const done = await threadPending();
        total = {touched: total.touched + done.touched, created: total.created + done.created, merged: total.merged + done.merged};
        process.stdout.write(`\r${from.toISOString()}: ${JSON.stringify(total)}, ${Math.round((Date.now() - started) / 1000)} s   `);
    }
    console.log(`\nDone: ${JSON.stringify(total)}`);
} finally {
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => {});
    await lock.end();
    await prisma.$disconnect();
}
