// where the time of one news goes in assign_stories, on the copies of halfvec-speed.mjs --keep
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const id = (await q(`SELECT id FROM bench_full WHERE id_story IS NOT NULL AND lang = 'en' ORDER BY created_at DESC LIMIT 1`))[0].id;
const parts = {
    rows: 'count(*)',
    title_dense: 'sum(-(m.title_dense <#> n.title_dense))',
    both_dense: 'sum(-(m.title_dense <#> n.title_dense) - (m.text_dense <#> n.text_dense))',
    title_sparse: 'sum(-(m.title_sparse <#> n.title_sparse))',
    all_three: 'sum(-(m.title_dense <#> n.title_dense) - (m.title_sparse <#> n.title_sparse) - (m.text_dense <#> n.text_dense))',
    figures: 'sum((cardinality(m.title_figures) > 0 AND m.title_figures <> n.title_figures)::int)',
};
for (const table of ['bench_full', 'bench_half', 'bench_full', 'bench_half']) {
    const line = [];
    for (const [name, expr] of Object.entries(parts)) {
        const t = performance.now();
        const [{v}] = await q(`WITH n AS (SELECT * FROM ${table} WHERE id = $1)
            SELECT ${expr} AS v FROM ${table} m, n WHERE m.id_story IS NOT NULL AND m.id <> n.id AND m.lang = n.lang
              AND COALESCE(m.published_at, m.created_at) >= COALESCE(n.published_at, n.created_at) - interval '48 hours'`, [id]);
        line.push(`${name} ${Math.round(performance.now() - t)} ms${name === 'rows' ? ` (${v})` : ''}`);
    }
    console.log(`${table}: ${line.join(' | ')}`);
}
await c.end();
