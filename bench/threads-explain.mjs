// the plan of the centroids step of assign_threads (read only)
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS)
    SELECT a.id_story, avg(a.text_dense) AS centroid,
           COALESCE(array_agg(DISTINCT a.medium) FILTER (WHERE a.medium IS NOT NULL), '{}') AS media
    FROM articles a JOIN stories x ON x.id = a.id_story
    WHERE x.grouped_at > COALESCE(x.threaded_at, '-infinity') AND a.text_dense IS NOT NULL
    GROUP BY a.id_story`)).rows.map(r => r['QUERY PLAN']);
console.log(plan.join('\n'));
await c.end();
