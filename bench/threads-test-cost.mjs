// what the isolation of the thread tests costs: the real stories waiting for their thread marked
// judged, in a transaction rolled back
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
console.log((await c.query("SELECT count(*) AS waiting FROM stories WHERE grouped_at > COALESCE(threaded_at, '-infinity')")).rows[0]);
await c.query('BEGIN');
let t = performance.now();
const r = await c.query("UPDATE stories SET threaded_at = now() WHERE grouped_at > COALESCE(threaded_at, '-infinity')");
console.log(`isolation: ${r.rowCount} stories in ${Math.round(performance.now() - t)} ms`);
t = performance.now();
const [x] = (await c.query("SELECT * FROM assign_threads(0.75, 0.10, 0.70, 7, NULL)")).rows;
console.log(`assign_threads with nothing waiting: ${JSON.stringify(x)} in ${Math.round(performance.now() - t)} ms`);
await c.query('ROLLBACK');
await c.end();
