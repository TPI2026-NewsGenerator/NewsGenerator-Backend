// cancel the query of one connection of this database running this function: node --env-file=.env bench/pg-cancel.mjs <pid> <function>
import pg from 'pg';
const [pid, fn] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity
    WHERE pid = $1 AND datname = current_database() AND query LIKE '%' || $2 || '%'`, [Number(pid), fn]);
console.log(rows);
await c.end();
