// run one SQL query on the database of .env and print the rows: node --env-file=.env bench/q.mjs "<sql>"
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const t = Date.now();
const {rows} = await c.query(process.argv[2]);
console.table(rows);
console.log(`${Date.now() - t} ms`);
await c.end();
