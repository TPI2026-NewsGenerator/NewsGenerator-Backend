// the size of the vector columns of the articles, and what Postgres stores apart (TOAST)
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (s) => (await c.query(s)).rows;
console.table(await q(`SELECT count(*) AS rows, round(avg(pg_column_size(title_dense))) AS title_dense, round(avg(pg_column_size(text_dense))) AS text_dense,
  round(avg(pg_column_size(title_sparse))) AS title_sparse, max(pg_column_size(title_sparse)) AS title_sparse_max,
  round(avg(pg_column_size(text_sparse))) AS text_sparse, max(pg_column_size(text_sparse)) AS text_sparse_max,
  round(avg(pg_column_size(description))) AS description, max(pg_column_size(description)) AS description_max,
  round(avg(pg_column_size(a.*))) AS row_logical
  FROM articles a WHERE created_at > now() - interval '2 days' AND embedded_at IS NOT NULL`));
console.table(await q(`SELECT pg_size_pretty(pg_relation_size('articles')) AS heap, pg_size_pretty(pg_relation_size(reltoastrelid)) AS toast,
  pg_size_pretty(pg_indexes_size('articles')) AS indexes, pg_size_pretty(pg_total_relation_size('articles')) AS total,
  (SELECT count(*) FROM articles) AS rows, (SELECT count(*) FROM articles WHERE embedded_at IS NOT NULL) AS embedded
  FROM pg_class WHERE relname = 'articles'`));
console.table(await q(`SELECT attname, attstorage FROM pg_attribute WHERE attrelid = 'articles'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`));
console.table(await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS db, current_setting('shared_buffers') AS shared_buffers, version()`));
await c.end();
