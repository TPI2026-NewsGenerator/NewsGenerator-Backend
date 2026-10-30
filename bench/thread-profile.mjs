// Nothing kept: the assign_threads of the working copy, with the time of each step raised as notices,
// run inside a transaction rolled back on stories threaded in the last minutes marked waiting again
// (see thread-merge-replay.mjs). lock_timeout under deadlock_timeout: it gives up on a row the
// server holds before Postgres looks for a deadlock, so the ingestion is never the one cancelled.
//   node --env-file=.env bench/thread-profile.mjs [stories=100] [minutes=10]
import fs from 'node:fs';
import pg from 'pg';

const count = Number(process.argv[2] ?? 100);
const minutes = Number(process.argv[3] ?? 10);
const sql = fs.readFileSync('db/add_threads.sql', 'utf8').replace(/\r\n/g, '\n');
const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.assign_threads');
let fn = sql.slice(start, sql.indexOf('END $$;', start) + 7)
    .replace('CREATE OR REPLACE FUNCTION public.assign_threads', 'CREATE FUNCTION pg_temp.assign_threads_profiled');

const step = (label) => `RAISE NOTICE '% %', '${label}', clock_timestamp() - step_at; step_at := clock_timestamp();`;
const place = (marker, replacement) => {
    if (!fn.includes(marker)) throw new Error(`not found: ${marker}`);
    fn = fn.replace(marker, replacement);
};
place('    n_merged integer := 0;\n', `    n_merged integer := 0;
    step_at timestamptz;
    merge_at timestamptz;
    full_time interval := '0';
    short_time interval := '0';
    n_full integer := 0;
    n_short integer := 0;
`);
place('BEGIN\n    -- each story waiting', 'BEGIN\n    step_at := clock_timestamp();\n    -- each story waiting');
place('    WHERE st.id = m.id_story;\n', `    WHERE st.id = m.id_story;\n    ${step('centroids of the stories')}\n`);
place('        n_touched := n_touched + 1;\n    END LOOP;\n', `        n_touched := n_touched + 1;\n    END LOOP;\n    ${step('stories judged')}\n`);
place('NOT EXISTS (SELECT 1 FROM stories o WHERE o.id_thread = th.id);\n',
    `NOT EXISTS (SELECT 1 FROM stories o WHERE o.id_thread = th.id);\n    ${step('threads updated')}\n`);
place('        IF only_story = ANY(judged) THEN\n', '        merge_at := clock_timestamp();\n        IF only_story = ANY(judged) THEN\n            n_short := n_short + 1;\n');
place('        ELSE\n            -- the media of every thread', '        ELSE\n            n_full := n_full + 1;\n            -- the media of every thread');
place('        IF best IS NOT NULL AND best_score >= merge_threshold THEN\n',
    `        IF only_story = ANY(judged) THEN short_time := short_time + (clock_timestamp() - merge_at);
        ELSE full_time := full_time + (clock_timestamp() - merge_at); END IF;
        IF best IS NOT NULL AND best_score >= merge_threshold THEN\n`);
place('    RETURN QUERY SELECT n_touched, n_created, n_merged;', `    ${step('threads joined')}
    RAISE NOTICE 'joins: % scanned in full (%), % on the changed threads only (%)', n_full, full_time, n_short, short_time;
    RETURN QUERY SELECT n_touched, n_created, n_merged;`);

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
c.on('notice', notice => console.log('  ' + notice.message));
await c.connect();
await c.query("SET lock_timeout = '500ms'");
// the schema of the temporary objects of this connection exists from its first one on
await c.query('CREATE TEMP TABLE profile_start (at timestamptz)');
await c.query(fn);
const run = async () => {
    await c.query('BEGIN');
    try {
        const sample = (await c.query(`SELECT id FROM stories WHERE threaded_at >= now() - make_interval(mins => $1) AND centroid IS NOT NULL
                                       ORDER BY random() LIMIT $2`, [minutes, count])).rows.map(row => row.id);
        await c.query("UPDATE stories SET threaded_at = now() WHERE grouped_at > COALESCE(threaded_at, '-infinity') AND NOT id = ANY($1)", [sample]);
        await c.query('UPDATE stories SET threaded_at = NULL WHERE id = ANY($1)', [sample]);
        const started = Date.now();
        const {rows: [counts]} = await c.query('SELECT * FROM pg_temp.assign_threads_profiled(0.75::real, 0.10::real, 0.70::real, 7, NULL::integer)');
        console.log(`${((Date.now() - started) / 1000).toFixed(1)} s, ${JSON.stringify(counts)}`);
    } finally {
        await c.query('ROLLBACK');
    }
};
for (let attempt = 1; ; attempt++) {
    try { await run(); break; } catch (error) {
        if (!['55P03', '40001'].includes(error.code) || attempt === 30) throw error;
        console.log(`attempt ${attempt}: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}
await c.end();
