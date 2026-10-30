// Search cards grouped by the stories of the ingestion: how many news of the 30 days kept have one
// node bench/story-coverage.mjs
import 'dotenv/config';
import pg from 'pg';

const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`
  SELECT d, count(*)::int n, count(*) FILTER (WHERE embedded_at IS NOT NULL)::int embedded, count(*) FILTER (WHERE id_story IS NOT NULL)::int in_story
  FROM (SELECT CASE WHEN now() - COALESCE(published_at, created_at) < interval '2 days' THEN '0-2 days'
                    WHEN now() - COALESCE(published_at, created_at) < interval '7 days' THEN '2-7 days'
                    ELSE '7-30 days' END AS d, embedded_at, id_story
        FROM articles WHERE COALESCE(published_at, created_at) > now() - interval '30 days') t
  GROUP BY d ORDER BY d`);
console.table(rows);
await c.end();
