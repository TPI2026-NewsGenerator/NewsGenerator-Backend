// the time of each step of MentionModel.save, on news already tagged (nothing new written but entities_at)
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT id FROM articles WHERE entities_at IS NOT NULL LIMIT 16`);
const ids = rows.map(r => r.id);
let t = Date.now();
await c.query('BEGIN');
await c.query(`INSERT INTO mentions (key, kind, name, lang, seen) VALUES ('zz-test', 'person', 'ZZ', 'en', 1) ON CONFLICT (key, kind) DO UPDATE SET seen = mentions.seen + 1 RETURNING id`);
console.log('mentions', Date.now() - t); t = Date.now();
await c.query(`UPDATE articles SET entities_at = now() WHERE id = ANY($1::int[])`, [ids]);
console.log('update articles', Date.now() - t); t = Date.now();
await c.query('ROLLBACK');
const lock = await c.query(`SELECT pid, state, wait_event_type, wait_event, now() - query_start AS running, left(query, 80) q FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle'`);
console.table(lock.rows);
await c.end();
