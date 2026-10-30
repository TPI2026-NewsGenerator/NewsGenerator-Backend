// Nothing kept: assign_threads of the last commit and of the working copy, run on the same real state
// inside one transaction rolled back (a snapshot of its own, each version under a savepoint), as
// temporary functions of this connection. The stories threaded in the last minutes are marked waiting
// again and judged by each version: same thread for each? (a thread made by the call is named by its
// first story). Locks the rows it touches for the time of the two calls.
//   node --env-file=.env bench/thread-merge-replay.mjs [stories=150] [minutes=30]
// CONTROL=1: the last commit against itself, what the replay alone changes (new threads get other ids)
import fs from 'node:fs';
import {execSync} from 'node:child_process';
import pg from 'pg';

const count = Number(process.argv[2] ?? 150);
const minutes = Number(process.argv[3] ?? 30);
const fnOf = (sql, name) => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.assign_threads');
    return sql.slice(start, sql.indexOf('END $$;', start) + 7)
        .replace('CREATE OR REPLACE FUNCTION public.assign_threads', `CREATE FUNCTION pg_temp.${name}`);
};
const versions = {
    old: fnOf(execSync('git show HEAD:db/add_threads.sql').toString(), 'assign_threads_old'),
    new: process.env.CONTROL ? fnOf(execSync('git show HEAD:db/add_threads.sql').toString(), 'assign_threads_new')
        : fnOf(fs.readFileSync('db/add_threads.sql', 'utf8'), 'assign_threads_new'),
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
await c.query("SET lock_timeout = '500ms'");
// the schema of the temporary objects of this connection exists from its first one on
await c.query('CREATE TEMP TABLE replay_start (at timestamptz)');
for (const sql of Object.values(versions)) await c.query(sql);

const replay = async () => {
await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
try {
    const sample = (await c.query(`SELECT id FROM stories WHERE threaded_at >= now() - make_interval(mins => $1) AND centroid IS NOT NULL
                                   ORDER BY random() LIMIT $2`, [minutes, count])).rows.map(row => row.id);
    // the other stories waiting are left out, as the tests of the threads do
    await c.query("UPDATE stories SET threaded_at = now() WHERE grouped_at > COALESCE(threaded_at, '-infinity') AND NOT id = ANY($1)", [sample]);
    await c.query('UPDATE stories SET threaded_at = NULL WHERE id = ANY($1)', [sample]);
    const {rows: [{top}]} = await c.query('SELECT max(id) AS top FROM threads');
    const results = {};
    for (const name of Object.keys(versions)) {
        await c.query('SAVEPOINT run');
        const started = Date.now();
        const {rows: [counts]} = await c.query(`SELECT * FROM pg_temp.assign_threads_${name}(0.75::real, 0.10::real, 0.70::real, 7, NULL::integer)`);
        const seconds = (Date.now() - started) / 1000;
        const {rows} = await c.query(`SELECT s.id, s.id_thread, (SELECT min(o.id) FROM stories o WHERE o.id_thread = s.id_thread) AS first
                                      FROM stories s WHERE s.id = ANY($1)`, [sample]);
        results[name] = new Map(rows.map(row => [row.id, row.id_thread <= top ? `thread ${row.id_thread}` : `new with story ${row.first}`]));
        // the stories of the thread of each, to tell a thread named otherwise from other stories together
        const {rows: members} = await c.query(`SELECT s.id, (SELECT array_agg(o.id ORDER BY o.id) FROM stories o WHERE o.id_thread = s.id_thread) AS together
                                               FROM stories s WHERE s.id = ANY($1)`, [sample]);
        results[name + 'Members'] = new Map(members.map(row => [row.id, row.together.join(',')]));
        console.log(`${name}: ${seconds.toFixed(1)} s, ${JSON.stringify(counts)}`);
        await c.query('ROLLBACK TO SAVEPOINT run');
    }
    let same = 0, sameMembers = 0;
    for (const id of sample) {
        if (results.old.get(id) === results.new.get(id)) same++;
        else console.log(`  story ${id}: old ${results.old.get(id)}, new ${results.new.get(id)}, same stories together: ${results.oldMembers.get(id) === results.newMembers.get(id)}`);
        if (results.oldMembers.get(id) === results.newMembers.get(id)) sameMembers++;
    }
    console.log(`${same}/${sample.length} stories in the same thread, ${sameMembers}/${sample.length} with the same stories together`);
} finally {
    await c.query('ROLLBACK');
}
};
// the ingestion of the server holds the rows it groups for the time of a call: tried again between two
for (let attempt = 1; ; attempt++) {
    try { await replay(); break; } catch (error) {
        if (!['55P03', '40001'].includes(error.code) || attempt === 40) throw error;
        console.log(`attempt ${attempt}: ${error.message}, again in 5 s`);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}
await c.end();
