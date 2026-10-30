// the plan of the score of one news in assign_stories as PL/pgSQL runs it: a prepared statement, with
// the plan of its values (custom) and the plan kept for any value (generic). Read only
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const [n] = (await c.query(`SELECT title_dense::text AS td, title_sparse::text AS ts, text_dense::text AS xd, lang, medium, title_figures,
    COALESCE(published_at, created_at) AS at FROM articles WHERE id_story IS NOT NULL AND lang = 'en' ORDER BY id DESC LIMIT 1`)).rows;
await c.query(`PREPARE score(timestamptz, halfvec, sparsevec, halfvec, text, text, text[], timestamptz) AS
    SELECT scored.id_story FROM (
        SELECT pairs.id_story,
               CASE WHEN bool_or(NOT pairs.same_medium) THEN
                        CASE WHEN AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) >= 0.6
                             THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.same_medium) END
                    WHEN NOT bool_or(pairs.other_figures) THEN AVG(pairs.similarity) - 0.5 END
               - 0.003 * GREATEST(0, EXTRACT(EPOCH FROM $8 - MAX(pairs.at)) / 3600 - 6) AS score
        FROM (SELECT m.id_story, -(m.title_dense <#> $2) - (m.title_sparse <#> $3) AS similarity, -(m.text_dense <#> $4) AS text_similarity,
                     m.medium IS NOT DISTINCT FROM $6 AS same_medium, COALESCE(m.published_at, m.created_at) AS at,
                     cardinality(m.title_figures) > 0 AND cardinality($7) > 0 AND m.title_figures <> $7 AS other_figures
              FROM articles m WHERE m.id_story IS NOT NULL AND m.lang = $5 AND COALESCE(m.published_at, m.created_at) >= $1 OFFSET 0) pairs
        GROUP BY pairs.id_story) scored
    WHERE scored.score >= 0.70 ORDER BY scored.score DESC LIMIT 1`);
const args = [new Date(Date.now() - 48 * 3600e3), n.td, n.ts, n.xd, n.lang, n.medium, n.title_figures, n.at];
for (const mode of ['force_custom_plan', 'force_generic_plan', 'force_custom_plan', 'force_generic_plan']) {
    await c.query(`SET plan_cache_mode = ${mode}`);
    const literal = (v) => v === null ? 'NULL' : Array.isArray(v) ? c.escapeLiteral(`{${v.join(',')}}`) : c.escapeLiteral(v instanceof Date ? v.toISOString() : String(v));
    const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE score(${args.map(literal).join(', ')})`)).rows.map(r => r['QUERY PLAN']);
    console.log(`--- ${mode}: ${plan.at(-1)}`);
    console.log(plan.filter(l => /Scan|Buffers|rows=/.test(l)).slice(0, 8).map(l => l.slice(0, 170)).join('\n'));
}
await c.end();
