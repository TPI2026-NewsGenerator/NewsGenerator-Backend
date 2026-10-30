import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (s) => (await c.query(s)).rows;
console.table(await q(`SELECT to_char(date_trunc('hour', created_at), 'MM-DD HH24') AS hour, count(*) AS created,
  count(*) FILTER (WHERE embedded_at IS NOT NULL) AS embedded_now, count(*) FILTER (WHERE id_story IS NOT NULL) AS grouped_now
  FROM articles WHERE created_at > now() - interval '30 hours' GROUP BY 1 ORDER BY 1`));
console.table(await q(`SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS day, count(*) AS created FROM articles
  WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1`));
console.table(await q(`SELECT count(*) AS stories_waiting_thread FROM stories WHERE grouped_at > COALESCE(threaded_at, '-infinity')`));
console.table(await q(`SELECT count(*) AS feeds, count(*) FILTER (WHERE url LIKE 'https://news.google.com/rss/search?%') AS google_search FROM feeds`));
console.log('total');
await c.end();
