// where the time of one news of assign_stories goes: settings, sizes, and the plan of its two queries
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
console.log(await q(`SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather','jit','server_version')`));
console.log(await q(`SELECT pg_size_pretty(pg_table_size('articles')) AS articles, pg_size_pretty(pg_relation_size('articles')) AS heap,
    pg_size_pretty(pg_total_relation_size('articles')) AS total, (SELECT count(*) FROM articles) AS rows`));
console.log(await q(`SELECT attname, avg(pg_column_size(a.*)) FROM (SELECT 1) x, LATERAL (SELECT 'row' AS attname) y, LATERAL (SELECT * FROM articles LIMIT 200) a GROUP BY attname`));
console.log(await q(`SELECT avg(pg_column_size(title_dense)) td, avg(pg_column_size(title_sparse)) ts, avg(pg_column_size(text_dense)) xd, avg(pg_column_size(text_sparse)) xs FROM (SELECT * FROM articles WHERE embedded_at IS NOT NULL LIMIT 500) a`));
console.log(await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'articles'`));
const [n] = await q(`SELECT id, lang, link, title, medium, title_dense, title_sparse, text_dense FROM articles WHERE embedded_at IS NOT NULL AND id_story IS NULL AND published_at > now() - interval '48 hours' LIMIT 1`);
const since = new Date(Date.now() - 48 * 3600e3);
for (const [name, sql, params] of [
    ['same link or title', `EXPLAIN (ANALYZE, BUFFERS) SELECT m.id_story FROM articles m WHERE m.id_story IS NOT NULL AND m.lang = $1 AND COALESCE(m.published_at, m.created_at) >= $2
        AND m.medium IS NOT DISTINCT FROM $3 AND (m.link = $4 OR m.title = $5) LIMIT 1`, [n.lang, since, n.medium, n.link, n.title]],
    ['scores', `EXPLAIN (ANALYZE, BUFFERS) SELECT m.id_story, -(m.title_dense <#> $3::vector) - 1 * (m.title_sparse <#> $4::sparsevec) AS s, -(m.text_dense <#> $5::vector) AS t
        FROM articles m WHERE m.id_story IS NOT NULL AND m.lang = $1 AND COALESCE(m.published_at, m.created_at) >= $2`, [n.lang, since, n.title_dense, n.title_sparse, n.text_dense]],
]) {
    console.log(`--- ${name}`);
    (await q(sql, params)).forEach(r => console.log(r['QUERY PLAN']));
}
await c.end();
