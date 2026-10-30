// the plan of the lookup of the same news already grouped (assign_stories), read only
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const [n] = (await c.query(`SELECT lang, medium, link, title FROM articles WHERE id_story IS NOT NULL AND lang = 'en' ORDER BY id DESC LIMIT 1 OFFSET 50`)).rows;
const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS) SELECT m.id_story FROM articles m WHERE m.id_story IS NOT NULL AND m.lang = $1
    AND COALESCE(m.published_at, m.created_at) >= now() - interval '48 hours' AND m.medium IS NOT DISTINCT FROM $2
    AND (m.link = $3 OR m.title = $4) LIMIT 1`, [n.lang, n.medium, n.link, n.title])).rows.map(r => r['QUERY PLAN']);
console.log(plan.map(l => l.slice(0, 170)).join('\n'));
await c.end();
