// What the connections of the API run in Postgres, every 2 s for some minutes (read only)
// node --env-file=.env bench/activity-watch.mjs [minutes=3]
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const end = Date.now() + (Number(process.argv[2]) || 3) * 60e3;
while (Date.now() < end) {
    const {rows} = await c.query(`
        SELECT state, wait_event_type AS wt, left(regexp_replace(query, '\s+', ' ', 'g'), 70) AS q,
               round(extract(epoch FROM now() - query_start))::int AS s
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle' AND query NOT ILIKE '%pg_advisory%'`);
    console.log(new Date().toISOString().slice(11, 19), rows.map(r => `[${r.state}${r.wt ? '/' + r.wt : ''} ${r.s}s] ${r.q}`).join(' || ') || '-');
    await new Promise(r => setTimeout(r, 2000));
}
await c.end();
