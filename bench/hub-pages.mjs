import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const rows = (await c.query(`SELECT medium, title, count(DISTINCT link)::int n, min(COALESCE(published_at, created_at)) first, max(COALESCE(published_at, created_at)) last
  FROM articles WHERE COALESCE(published_at, created_at) >= now() - interval '14 days' AND medium IS NOT NULL
  GROUP BY medium, title HAVING count(DISTINCT link) >= 3 ORDER BY n ASC LIMIT 400`)).rows;
console.log(rows.length, 'pairs');
for (const r of rows.filter(r => r.n <= 4).slice(0, 60)) console.log(r.n, r.medium, '|', r.title.slice(0, 90), '|', Math.round((r.last - r.first) / 3600e3), 'h');
await c.end();
