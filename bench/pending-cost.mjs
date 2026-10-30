// The cost of pendingArticles (models/story-model.js): EXPLAIN ANALYZE, read only
// node --env-file=.env bench/pending-cost.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`EXPLAIN (ANALYZE, BUFFERS)
    SELECT a.id, a.title, a.description, f.url AS feed,
           COALESCE((SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url AND uf.language IS NOT NULL LIMIT 1),
                    (SELECT d.language FROM directory_feeds d WHERE d.url = f.url)) AS feed_language
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.embedded_at IS NULL AND COALESCE(a.published_at, a.created_at) >= now() - interval '48 hours'
      AND (NULL::text[] IS NULL OR f.url = ANY(NULL::text[]))
    ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT 100`);
console.log(rows.map(r => r['QUERY PLAN']).join('\n'));
console.log((await c.query(`SELECT count(*) FILTER (WHERE embedded_at IS NULL) AS pending, count(*) AS total FROM articles`)).rows[0]);
console.log((await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'articles'`)).rows.map(r => r.indexdef).join('\n'));
await c.end();
