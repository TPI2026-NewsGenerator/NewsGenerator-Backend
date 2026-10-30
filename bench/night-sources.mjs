// where last night's news came from: node --env-file=.env bench/night-sources.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
console.table((await c.query(`SELECT CASE WHEN f.url LIKE 'https://news.google.com/rss/search?%' THEN 'google search'
    WHEN f.url LIKE 'https://news.google.com/%' THEN 'google other' ELSE 'feeds' END AS source,
  count(*) AS news, count(DISTINCT f.id) AS feeds
  FROM articles a JOIN feeds f ON f.id = a.id_feed
  WHERE a.created_at >= '2026-10-01 00:00' AND a.created_at < '2026-10-01 04:00' GROUP BY 1 ORDER BY 2 DESC`)).rows);
console.table((await c.query(`SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS day,
  count(*) FILTER (WHERE f.url LIKE 'https://news.google.com/rss/search?%') AS google_search, count(*) AS all
  FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE a.created_at > now() - interval '8 days' GROUP BY 1 ORDER BY 1`)).rows);
await c.end();
