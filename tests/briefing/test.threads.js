//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.threads.js
//  Description: Tests of the threads computed by pgvector: the stories of one affair linked
//               (assign_threads, db/add_threads.sql)
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {toVector} from '../../services/utils/embedder.js'

// The function lives in the database, so it is tested there. Every test runs in a transaction rolled
// back at its end, in a language of its own ('zz') so its stories never meet real ones.
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query("SELECT 'public.assign_threads'::regproc, '[1]'::vector");
} catch {
    dbAvailable = false;
    console.warn('Database, pgvector or db/add_threads.sql not available, the thread tests are skipped');
}
afterAll(() => pool.end());

const THRESHOLD = 0.75;
const SAME_MEDIUM_MARGIN = 0.10;
const MERGE_THRESHOLD = 0.70;
const ACTIVE_DAYS = 7;
const LANG = 'zz';

// a normalized vector of 1024 numbers, the ones given first and zeros after
const dense = (...values) => {
    const vector = new Float32Array(1024);
    const norm = Math.hypot(...values);
    values.forEach((value, i) => vector[i] = value / norm);
    return toVector(vector);
};

const inTransaction = async (test) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // the stories of the real news waiting for their thread are left out, in the transaction only:
        // judged with the test ones, thousands of them after a first read took minutes
        await client.query("UPDATE stories SET threaded_at = now() WHERE grouped_at > COALESCE(threaded_at, '-infinity')");
        const {rows: [feed]} = await client.query("INSERT INTO feeds (url) VALUES ('https://test.invalid/feed') RETURNING id");
        await test(client, feed.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

let counter = 0;
// a story of one news (its text vector 'text'), written by 'medium', just grouped; 'hours' after 2100
// began. Or a news more in the story 'story'
const story = async (client, feed, {text, medium = `m${++counter}`, hours = 0, lang = LANG, story: id = null}) => {
    if (id === null) {
        ({rows: [{id}]} = await client.query(`
            INSERT INTO stories (lang, updated_at, grouped_at)
            VALUES ($1, timestamptz '2100-01-01T00:00:00Z' + make_interval(hours => $2), now()) RETURNING id`, [lang, hours]));
    } else {
        // grouped again after its thread was judged
        await client.query("UPDATE stories SET grouped_at = clock_timestamp() WHERE id = $1", [id]);
    }
    await client.query(`
        INSERT INTO articles (id_feed, link, title, published_at, lang, text_dense, embedded_at, id_story)
        VALUES ($1, $2, 'test', timestamptz '2100-01-01T00:00:00Z' + make_interval(hours => $3), $4, $5::halfvec, now(), $6)`,
        [feed, `https://${medium}.invalid/${++counter}`, hours, lang, text, id]);
    return id;
};

const threadOf = async (client, id) => (await client.query('SELECT id_thread FROM stories WHERE id = $1', [id])).rows[0].id_thread;
const assign = async (client) => (await client.query('SELECT * FROM public.assign_threads($1, $2, $3, $4)',
    [THRESHOLD, SAME_MEDIUM_MARGIN, MERGE_THRESHOLD, ACTIVE_DAYS])).rows[0];

(dbAvailable ? describe : describe.skip)('assign_threads', () => {
    it('should link the facts of one affair told by other media, and leave the others apart', () => inTransaction(async (client, feed) => {
        const preview = await story(client, feed, {text: dense(1, 0, 0)});
        await assign(client);
        const result = await story(client, feed, {hours: 30, text: dense(1, 0.4, 0)});      // 0.93
        const other = await story(client, feed, {hours: 31, text: dense(0, 0, 1)});
        await assign(client);

        expect(await threadOf(client, result)).toBe(await threadOf(client, preview));
        expect(await threadOf(client, other)).not.toBe(await threadOf(client, preview));
    }));

    it('should judge only the oldest stories asked for, and leave the others to the next call', () => inTransaction(async (client, feed) => {
        const first = await story(client, feed, {hours: 1, text: dense(1, 0)});
        const second = await story(client, feed, {hours: 2, text: dense(0, 1)});

        await client.query('SELECT * FROM public.assign_threads($1, $2, $3, $4, $5)',
            [THRESHOLD, SAME_MEDIUM_MARGIN, MERGE_THRESHOLD, ACTIVE_DAYS, 1]);
        expect(await threadOf(client, first)).not.toBeNull();
        expect(await threadOf(client, second)).toBeNull();

        await assign(client);
        expect(await threadOf(client, second)).not.toBeNull();
    }));

    it('should keep apart the series of one medium unless almost the same', () => inTransaction(async (client, feed) => {
        // 0.72: enough from another medium (two threads become one at 0.70), not from the same one (0.10 more)
        const monday = await story(client, feed, {medium: 'paper', text: dense(1, 0)});
        await assign(client);
        const tuesday = await story(client, feed, {medium: 'paper', hours: 24, text: dense(0.72, 0.694)});
        await assign(client);
        expect(await threadOf(client, tuesday)).not.toBe(await threadOf(client, monday));

        const again = await story(client, feed, {medium: 'paper', hours: 25, text: dense(1, 0.1)});    // 0.995
        await assign(client);
        expect(await threadOf(client, again)).toBe(await threadOf(client, monday));
    }));

    it('should never link two languages', () => inTransaction(async (client, feed) => {
        const a = await story(client, feed, {text: dense(1, 0)});
        const b = await story(client, feed, {text: dense(1, 0), lang: 'zy'});
        await assign(client);
        expect(await threadOf(client, a)).not.toBe(await threadOf(client, b));
    }));

    it('should join two threads of one affair born apart', () => inTransaction(async (client, feed) => {
        // 0.72: below what a story needs to join a thread, above what two threads need to become one
        const verdict = await story(client, feed, {text: dense(1, 0)});
        await assign(client);
        const reactions = await story(client, feed, {hours: 20, text: dense(0.72, 0.694)});
        const {merged} = await assign(client);

        expect(merged).toBe(1);
        expect(await threadOf(client, reactions)).toBe(await threadOf(client, verdict));
    }));

    it('should judge a story again when it gets news, and drop the thread it leaves empty', () => inTransaction(async (client, feed) => {
        const a = await story(client, feed, {text: dense(1, 0, 0)});
        const b = await story(client, feed, {text: dense(0, 0, 1)});
        await assign(client);
        const alone = await threadOf(client, b);
        expect(alone).not.toBe(await threadOf(client, a));

        // its new news make it the same affair as a: centroid (0.05, 0, 1) + 3 x (1, 0, 0) -> 0.95 with a
        for (let i = 0; i < 3; i++) await story(client, feed, {story: b, hours: 2, text: dense(1, 0, 0)});
        await assign(client);
        expect(await threadOf(client, b)).toBe(await threadOf(client, a));
        expect((await client.query('SELECT 1 FROM threads WHERE id = $1', [alone])).rowCount).toBe(0);
    }));
});
