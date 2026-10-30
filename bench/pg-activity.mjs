// what the connections of this database are doing: node --env-file=.env bench/pg-activity.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT pid, state, wait_event_type, wait_event, now() - query_start AS running, left(regexp_replace(query, '\s+', ' ', 'g'), 140) AS query
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY query_start`);
rows.forEach(r => console.log(`${r.pid} ${r.state} ${r.wait_event_type ?? ''}/${r.wait_event ?? ''} ${JSON.stringify(r.running)} | ${r.query}`));
console.log((await c.query(`SELECT count(*) AS stories, max(created_at) AS last_story FROM stories`)).rows[0]);
await c.end();
