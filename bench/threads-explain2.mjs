// the plan of the score of one story in assign_threads (read only)
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const [s] = (await c.query(`SELECT centroid::text AS v, media, lang FROM stories WHERE centroid IS NOT NULL AND lang = 'en' ORDER BY id DESC LIMIT 1`)).rows;
const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS)
    SELECT pairs.id_thread, CASE WHEN bool_or(NOT pairs.shared) THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.shared)
                                 ELSE AVG(pairs.similarity) - 0.1 END AS score
    FROM (SELECT o.id_thread, -(o.centroid <#> $1::halfvec(1024)) AS similarity, o.media && $2::text[] AS shared
          FROM stories o JOIN threads th ON th.id = o.id_thread
          WHERE o.lang = $3 AND th.updated_at >= now() - interval '7 days' AND o.centroid IS NOT NULL OFFSET 0) pairs
    GROUP BY pairs.id_thread`, [s.v, s.media, s.lang])).rows.map(r => r['QUERY PLAN']);
console.log(plan.join('\n'));
await c.end();
