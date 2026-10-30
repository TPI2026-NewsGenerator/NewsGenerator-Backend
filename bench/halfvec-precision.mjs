// Does half precision change what the vectors decide? On the real news, the same computations with the
// dense vectors as stored (vector, 32 bits) and cast to halfvec (16 bits):
//  1. grouping: the story assign_stories would give a news (the score of each story of the window)
//  2. search by sentence: the 80 closest news of 7 days (closestArticles)
//  3. briefing: the 50 closest news of 48 h of each interest of the profiles (rank_stories)
// node --env-file=.env bench/halfvec-precision.mjs [news=120]   -> bench/data/halfvec/precision.json
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import {embed, toSparsevec, toVector} from '../services/utils/embedder.js';

const NEWS = Number(process.argv[2]) || 120;
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const out = {};

// 1. grouping, the parameters of ingest-service.js
const T = {threshold: 0.70, sparse: 1, margin: 0.5, text: 0.6, decay: 0.003, grace: 6};
const score = (cast) => `
    SELECT pairs.id_story,
           CASE WHEN bool_or(NOT pairs.same_medium) THEN
                    CASE WHEN AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) >= ${T.text}
                         THEN AVG(pairs.similarity) FILTER (WHERE NOT pairs.same_medium) END
                WHEN NOT bool_or(pairs.other_figures) THEN AVG(pairs.similarity) - ${T.margin} END
           - ${T.decay} * GREATEST(0, EXTRACT(EPOCH FROM (SELECT at FROM n) - MAX(pairs.at)) / 3600 - ${T.grace}) AS score,
           AVG(pairs.text_similarity) FILTER (WHERE NOT pairs.same_medium) AS text_avg
    FROM n, LATERAL (
        SELECT m.id_story,
               -(m.title_dense${cast} <#> n.title_dense${cast}) - ${T.sparse} * (m.title_sparse <#> n.title_sparse) AS similarity,
               -(m.text_dense${cast} <#> n.text_dense${cast}) AS text_similarity,
               m.medium IS NOT DISTINCT FROM n.medium AS same_medium,
               COALESCE(m.published_at, m.created_at) AS at,
               cardinality(m.title_figures) > 0 AND cardinality(n.title_figures) > 0 AND m.title_figures <> n.title_figures AS other_figures
        FROM articles m
        WHERE m.id_story IS NOT NULL AND m.id <> n.id AND m.lang = n.lang
          AND COALESCE(m.published_at, m.created_at) >= n.at - interval '48 hours' AND COALESCE(m.published_at, m.created_at) <= n.at
    ) pairs GROUP BY pairs.id_story`;
const sample = await q(`SELECT id FROM articles WHERE id_story IS NOT NULL AND created_at > now() - interval '30 hours'
    ORDER BY md5(id::text) LIMIT $1`, [NEWS]);
const grouping = [];
let started = Date.now();
for (const [i, {id}] of sample.entries()) {
    const rows = await q(`WITH n AS (SELECT id, lang, medium, title_figures, title_dense, title_sparse, text_dense,
            COALESCE(published_at, created_at) AS at FROM articles WHERE id = $1),
        full_ AS (${score('')}), half AS (${score('::halfvec')})
        SELECT f.id_story, f.score AS full_score, h.score AS half_score, f.text_avg AS full_text, h.text_avg AS half_text
        FROM full_ f JOIN half h USING (id_story)`, [id]);
    const best = (key) => rows.filter(r => r[key] !== null && r[key] >= T.threshold).sort((a, b) => b[key] - a[key])[0]?.id_story ?? null;
    const diffs = rows.flatMap(r => [r.full_score !== null && r.half_score !== null ? Math.abs(r.full_score - r.half_score) : null,
        r.full_text !== null ? Math.abs(r.full_text - r.half_text) : null]).filter(d => d !== null);
    // the decisions on each side of a threshold that half precision moves
    const flips = rows.filter(r => (r.full_score >= T.threshold) !== (r.half_score >= T.threshold)
        || (r.full_text >= T.text) !== (r.half_text >= T.text)).length;
    grouping.push({id, stories: rows.length, full: best('full_score'), half: best('half_score'), maxDiff: Math.max(0, ...diffs), flips});
    if (i % 20 === 19) console.log(`grouping ${i + 1}/${sample.length} (${Math.round((Date.now() - started) / 1000)} s)`);
}
const same = grouping.filter(g => g.full === g.half).length;
out.grouping = {news: grouping.length, sameStory: same, storiesCompared: grouping.reduce((s, g) => s + g.stories, 0),
    flips: grouping.reduce((s, g) => s + g.flips, 0), maxScoreDiff: Math.max(...grouping.map(g => g.maxDiff)), differ: grouping.filter(g => g.full !== g.half)};
console.log(`grouping: same story for ${same}/${grouping.length} news, ${out.grouping.flips} threshold crossings over ${out.grouping.storiesCompared} stories, max score change ${out.grouping.maxScoreDiff.toFixed(5)}`);

// 2. search by sentence
const SENTENCES = ["l'arbitrage vidéo en Ligue 1", 'les nouveaux modèles de voitures électriques', 'les cartes Pokémon',
    'the Artemis II astronauts of NASA', 'Premier League referee decisions', "the America's Cup sailing race",
    "le budget de l'État et la réforme des retraites en France", "les prix de l'immobilier en Suisse", 'les vendanges en Valais',
    'les incendies de forêt', 'the interest rate decision of the Federal Reserve', 'measles outbreaks',
    'the Swiss chocolate industry', 'new AI models for programming', 'Taylor Swift', 'du football mais pas le PSG',
    "l'intelligence artificielle à l'hôpital"];
const vectors = await embed(SENTENCES);
const closest = (cast) => `SELECT id FROM articles WHERE embedded_at IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '7 days'
    ORDER BY -(text_dense${cast} <#> $1::vector${cast}) - 0.5 * (text_sparse <#> $2::sparsevec) DESC, id LIMIT 80`;
out.search = [];
for (const [i, sentence] of SENTENCES.entries()) {
    const params = [toVector(vectors[i].dense), toSparsevec(vectors[i].sparse)];
    const full = (await q(closest(''), params)).map(r => r.id);
    const half = (await q(closest('::halfvec'), params)).map(r => r.id);
    const common = full.filter(id => half.includes(id)).length;
    const samePlace = full.filter((id, k) => half[k] === id).length;
    out.search.push({sentence, common, samePlace, swapped: full.filter(id => !half.includes(id)).map(id => full.indexOf(id) + 1)});
    console.log(`${sentence.slice(0, 40).padEnd(40)} ${common}/80 in common, ${samePlace} at the same place${common < 80 ? `, out: rank ${out.search.at(-1).swapped.join(', ')}` : ''}`);
}

// 3. briefing
const interests = await q(`SELECT id, text FROM profile_interests WHERE dense IS NOT NULL ORDER BY id`);
const ranked = (cast) => `SELECT a.id FROM articles a, profile_interests i WHERE i.id = $1 AND a.embedded_at IS NOT NULL
    AND COALESCE(a.published_at, a.created_at) > now() - interval '48 hours'
    ORDER BY -(a.text_dense${cast} <#> i.dense${cast}) - 0.5 * (a.text_sparse <#> i.sparse) DESC, a.id LIMIT 50`;
out.briefing = [];
started = Date.now();
for (const interest of interests) {
    const full = (await q(ranked(''), [interest.id])).map(r => r.id);
    const half = (await q(ranked('::halfvec'), [interest.id])).map(r => r.id);
    out.briefing.push({interest: interest.text, common: full.filter(id => half.includes(id)).length,
        swapped: full.filter(id => !half.includes(id)).map(id => full.indexOf(id) + 1)});
}
const full50 = out.briefing.filter(b => b.common === 50).length;
console.log(`briefing: ${interests.length} interests, top 50 identical for ${full50}, ${out.briefing.reduce((s, b) => s + 50 - b.common, 0)} news swapped in all (ranks ${out.briefing.flatMap(b => b.swapped).join(', ')}) (${Math.round((Date.now() - started) / 1000)} s)`);

fs.mkdirSync('bench/data/halfvec', {recursive: true});
fs.writeFileSync('bench/data/halfvec/precision.json', JSON.stringify(out, null, 1));
await c.end();
process.exit(0);
