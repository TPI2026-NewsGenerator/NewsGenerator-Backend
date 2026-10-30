import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
console.log((await c.query(`
  SELECT date_trunc('day', created_at)::date AS day,
         count(*) FILTER (WHERE created_at > now() - interval '48 hours' AND embedded_at IS NULL)::int AS pending,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM embedded_at - created_at) / 60)::int AS median_delay_min,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM embedded_at - created_at) / 60)::int AS p90_delay_min
  FROM articles WHERE created_at > '2026-10-01T00:57Z' GROUP BY 1 ORDER BY 1`)).rows);
// same medium share: Saturday has fewer media writing; distinct media active in each window
console.log((await c.query(`
  SELECT d, count(DISTINCT medium)::int AS media, count(*)::int AS news FROM (
    SELECT CASE WHEN created_at < '2026-10-03' THEN 'Fri 2.10' ELSE 'Sat 3.10' END AS d, medium FROM articles
    WHERE (created_at >= '2026-10-02T00:57:30Z' AND created_at < '2026-10-02T07:00Z')
       OR (created_at >= '2026-10-03T00:57:30Z' AND created_at < '2026-10-03T07:00Z')) x GROUP BY d`)).rows);
await c.end();
