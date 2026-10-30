import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
console.log(await q(`SELECT count(*)::int FROM articles WHERE title ILIKE '%tcg%' OR title ILIKE '%pokémon%' OR title ILIKE '%pokemon%'`));
console.log(await q(`SELECT a.lang, f.url, count(*)::int n, max(a.title) sample, max(a.created_at)::date newest
  FROM articles a JOIN feeds f ON f.id = a.id_feed
  WHERE a.title ILIKE '%tcg%' OR a.title ILIKE '%trading card%' OR a.title ILIKE '%cartes pok%' OR a.title ILIKE '%jcc%' OR a.title ILIKE '%lorcana%'
  GROUP BY 1,2 ORDER BY n DESC LIMIT 25`));
await c.end();
