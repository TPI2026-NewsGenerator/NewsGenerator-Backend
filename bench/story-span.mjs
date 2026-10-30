// How long the stories of the last days last: span between their first and last news, per size.
// node bench/story-span.mjs [days]
import 'dotenv/config';
import pg from 'pg';
const days = Number(process.argv[2] ?? 7);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`
  WITH s AS (SELECT id_story, count(*) n, count(DISTINCT medium) media,
                    extract(epoch FROM max(COALESCE(published_at, created_at)) - min(COALESCE(published_at, created_at))) / 3600 AS hours
             FROM articles WHERE id_story IS NOT NULL
               AND id_story IN (SELECT id_story FROM articles WHERE COALESCE(published_at, created_at) > now() - make_interval(days => $1::int) AND id_story IS NOT NULL)
             GROUP BY id_story)
  SELECT CASE WHEN media = 1 THEN '1 medium' WHEN media <= 3 THEN '2-3 media' ELSE '4+ media' END AS size,
         count(*)::int stories,
         count(*) FILTER (WHERE hours < 12)::int "<12h", count(*) FILTER (WHERE hours >= 12 AND hours < 24)::int "12-24h",
         count(*) FILTER (WHERE hours >= 24 AND hours < 48)::int "24-48h", count(*) FILTER (WHERE hours >= 48 AND hours < 72)::int "48-72h",
         count(*) FILTER (WHERE hours >= 72)::int "72h+"
  FROM s GROUP BY 1 ORDER BY 1`, [days]);
console.table(rows);
const {rows: [x]} = await c.query(`SELECT min(created_at) first_grouped FROM articles WHERE id_story IS NOT NULL`);
console.log('first news in a story created at', x.first_grouped);
await c.end();
