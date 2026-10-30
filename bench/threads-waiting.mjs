// stories waiting for their thread: node --env-file=.env bench/threads-waiting.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
console.log((await c.query(`SELECT count(*) AS waiting, min(grouped_at) AS oldest FROM stories WHERE grouped_at > COALESCE(threaded_at, '-infinity')`)).rows[0]);
await c.end();
