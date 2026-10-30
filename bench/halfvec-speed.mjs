// How much faster are the vectors in half precision kept in the row? Two copies of the news of the last
// 3 days (every column): bench_full as articles is (vector(1024), stored apart by Postgres: TOAST) and
// bench_half (halfvec(1024) STORAGE PLAIN, toast_tuple_target 8160: nothing smaller than a page apart).
// Timed on both, alternately: the score of every story of the window for a news (assign_stories, the
// part repeated for each news) and the 80 closest news of a sentence (closestArticles).
// node --env-file=.env bench/halfvec-speed.mjs [news=15] [--keep]   (the copies are dropped at the end)
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const NEWS = Number(process.argv[2]) || 15;
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const timed = async (sql, params) => { const t = performance.now(); await q(sql, params); return performance.now() - t; };

const WINDOW = `embedded_at IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '3 days'`;
let t = Date.now();
await q('DROP TABLE IF EXISTS bench_full, bench_half');
await q('CREATE TABLE bench_full (LIKE articles)');
await q(`INSERT INTO bench_full SELECT * FROM articles WHERE ${WINDOW}`);
await q('CREATE TABLE bench_half (LIKE articles) WITH (toast_tuple_target = 8160)');
await q(`ALTER TABLE bench_half ALTER COLUMN title_dense TYPE halfvec(1024), ALTER COLUMN text_dense TYPE halfvec(1024),
    ALTER COLUMN title_dense SET STORAGE PLAIN, ALTER COLUMN text_dense SET STORAGE PLAIN`);
await q(`INSERT INTO bench_half SELECT * FROM articles WHERE ${WINDOW}`);
for (const table of ['bench_full', 'bench_half']) {
    await q(`CREATE INDEX ON ${table} (lang, (COALESCE(published_at, created_at))) WHERE id_story IS NOT NULL`);
    await q(`ANALYZE ${table}`);
}
console.log(`copies made in ${Math.round((Date.now() - t) / 1000)} s`);
console.table(await q(`SELECT relname, (SELECT count(*) FROM bench_full) AS rows, pg_size_pretty(pg_relation_size(oid)) AS heap,
    pg_size_pretty(pg_relation_size(reltoastrelid)) AS toast, pg_size_pretty(pg_total_relation_size(oid)) AS total
    FROM pg_class WHERE relname IN ('bench_full', 'bench_half')`));

// assign_stories, the score of each story of the window for one news (db/add_briefing.sql)
const story = (table) => `
    WITH n AS (SELECT id, lang, medium, title_figures, title_dense, title_sparse, text_dense,
                      COALESCE(published_at, created_at) AS at FROM ${table} WHERE id = $1)
    SELECT scored.id_story FROM (
        SELECT pairs.id_story,
               CASE WHEN bool_or(NOT pairs.same_medium) THEN
                        CASE WHEN AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) >= 0.6
                             THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.same_medium) END
                    WHEN NOT bool_or(pairs.other_figures) THEN AVG(pairs.similarity) - 0.5 END
               - 0.003 * GREATEST(0, EXTRACT(EPOCH FROM (SELECT at FROM n) - MAX(pairs.at)) / 3600 - 6) AS score
        FROM (SELECT m.id_story,
                     -(m.title_dense <#> n.title_dense) - (m.title_sparse <#> n.title_sparse) AS similarity,
                     -(m.text_dense <#> n.text_dense) AS text_similarity,
                     m.medium IS NOT DISTINCT FROM n.medium AS same_medium,
                     COALESCE(m.published_at, m.created_at) AS at,
                     cardinality(m.title_figures) > 0 AND cardinality(n.title_figures) > 0 AND m.title_figures <> n.title_figures AS other_figures
              FROM ${table} m, n
              WHERE m.id_story IS NOT NULL AND m.id <> n.id AND m.lang = n.lang
                AND COALESCE(m.published_at, m.created_at) >= n.at - interval '48 hours') pairs
        GROUP BY pairs.id_story) scored
    WHERE scored.score >= 0.70 ORDER BY scored.score DESC LIMIT 1`;
// closestArticles: a sentence against the news of the window
const closest = (table) => `SELECT id, title, description FROM ${table}
    ORDER BY -(text_dense <#> (SELECT text_dense FROM ${table} WHERE id = $1)) - 0.5 * (text_sparse <#> (SELECT text_sparse FROM ${table} WHERE id = $1)) DESC LIMIT 80`;

const ids = (await q(`SELECT id FROM bench_full WHERE id_story IS NOT NULL AND created_at > now() - interval '24 hours' ORDER BY md5(id::text) LIMIT $1`, [NEWS])).map(r => r.id);
const times = {full: {story: [], closest: []}, half: {story: [], closest: []}};
for (const [i, id] of ids.entries()) {
    // alternately, which one goes first changing from news to news
    const order = i % 2 ? ['half', 'full'] : ['full', 'half'];
    for (const kind of order) times[kind].story.push(await timed(story(`bench_${kind}`), [id]));
    for (const kind of order) times[kind].closest.push(await timed(closest(`bench_${kind}`), [id]));
    console.log(`${i + 1}/${ids.length}: story ${Math.round(times.full.story.at(-1))} / ${Math.round(times.half.story.at(-1))} ms, closest ${Math.round(times.full.closest.at(-1))} / ${Math.round(times.half.closest.at(-1))} ms`);
}
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const result = Object.fromEntries(Object.entries(times).map(([kind, t]) => [kind, {story: Math.round(median(t.story)), closest: Math.round(median(t.closest))}]));
console.log('median ms (full = as today, half = halfvec in the row):');
console.table(result);
fs.mkdirSync('bench/data/halfvec', {recursive: true});
fs.writeFileSync('bench/data/halfvec/speed.json', JSON.stringify({ids, times, result}, null, 1));
if (!process.argv.includes('--keep')) await q('DROP TABLE IF EXISTS bench_full, bench_half');
await c.end();
process.exit(0);
