// one SQL query, printed as a table: node --env-file=.env bench/pg-q.mjs "SELECT ..."
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const t = Date.now();
const r = await c.query(process.argv[2]);
console.table(r.rows);
console.log(`${Date.now() - t} ms`);
await c.end();
