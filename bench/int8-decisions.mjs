// Does bge-m3 in int8 change what the vectors decide? Same three decisions as halfvec-precision.mjs,
// the stored vectors (bge-m3 fp32, the server's) against vectors all made by an int8 engine of
// bench/int8/embedder.py, both sides scored the same way in JS:
//  1. grouping: the story assign_stories gives a news. The candidates are the 6 stories of the window
//     closest to it by the stored titles (others are far below the threshold); their members (30 at
//     most per story, the same on both sides) and the news are embedded again in int8
//  2. search by sentence: the 80 closest news of 7 days (text dense + 0.5 sparse). Candidates = the 120
//     closest by the stored vectors to the fp32 query and to the int8 query, all embedded in int8
//  3. briefing: the 50 closest news of 48 h of each interest of the profiles, same way
// node --env-file=.env bench/int8-decisions.mjs [engine=int8pc] [news=120]   -> bench/data/int8/decisions-<engine>.json
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const ENGINE = process.argv[2] || 'int8pc';
const NEWS = Number(process.argv[3]) || 120;
const PORTS = {torch: 8030, onnx: 8031, int8: 8032, int8pc: 8033, int8x: 8034};
const T = {threshold: 0.70, sparse: 1, margin: 0.5, text: 0.6, decay: 0.003, grace: 6};   // ingest-service.js
const CANDIDATE_STORIES = 6;
const MAX_MEMBERS = 30;
const DESCRIPTION_CHARS = 400;
const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS);
    return text ? `${title}. ${text}` : title;
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

const dense = (text) => Float64Array.from(JSON.parse(text));
const sparse = (text) => Object.fromEntries(text.slice(1, text.indexOf('}')).split(',').filter(Boolean)
    .map(pair => pair.split(':')).map(([i, w]) => [String(Number(i) - 1), Number(w)]));
const toSparsevec = (weights) => `{${Object.entries(weights).map(([t, w]) => [Number(t) + 1, w]).sort((a, b) => a[0] - b[0])
    .map(([i, w]) => `${i}:${w}`).join(',')}}/250002`;
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const sdot = (a, b) => { let s = 0; for (const k in a) if (k in b) s += a[k] * b[k]; return s; };

// texts -> [{dense, sparse}], cached: a news met twice is embedded once
const cache = new Map();
let embedded = 0, seconds = 0;
const embed = async (texts) => {
    const missing = [...new Set(texts.filter(t => !cache.has(t)))];
    for (let k = 0; k < missing.length; k += 32) {
        const batch = missing.slice(k, k + 32);
        const res = await fetch(`http://127.0.0.1:${PORTS[ENGINE]}/embed`, {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({texts: batch}), signal: AbortSignal.timeout(30 * 60e3)});
        const body = await res.json();
        batch.forEach((t, i) => cache.set(t, {dense: Float64Array.from(body.dense[i]), sparse: body.sparse[i]}));
        embedded += batch.length; seconds += body.seconds;
    }
    return texts.map(t => cache.get(t));
};
const embedWith = async (port, texts) => {
    const res = await fetch(`http://127.0.0.1:${port}/embed`, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({texts})});
    const body = await res.json();
    return body.dense.map((d, i) => ({dense: Float64Array.from(d), sparse: body.sparse[i]}));
};
const out = {engine: ENGINE};

// 1. grouping
// the score of a story for a news, as assign_stories: m = its members [{td, ts, xd, medium, at, figures}]
const storyScore = (n, members) => {
    const pairs = members.map(m => ({similarity: dot(m.td, n.td) + T.sparse * sdot(m.ts, n.ts), text: dot(m.xd, n.xd),
        same: m.medium === n.medium, at: m.at,
        otherFigures: m.figures.length > 0 && n.figures.length > 0 && m.figures.join('|') !== n.figures.join('|')}));
    const others = pairs.filter(p => !p.same);
    const avg = (list, key) => list.reduce((s, p) => s + p[key], 0) / list.length;
    let score = null, textAvg = null;
    if (others.length > 0) {
        textAvg = avg(others, 'text');
        score = textAvg >= T.text ? avg(others, 'similarity') : null;
    } else if (!pairs.some(p => p.otherFigures)) {
        score = avg(pairs, 'similarity') - T.margin;
    }
    if (score === null) return {score: null, textAvg};
    const last = Math.max(...pairs.map(p => p.at));
    return {score: score - T.decay * Math.max(0, (n.at - last) / 3600e3 - T.grace), textAvg};
};
const best = (scores) => scores.filter(s => s.score !== null && s.score >= T.threshold).sort((a, b) => b.score - a.score)[0]?.story ?? null;

const sample = await q(`SELECT id FROM articles WHERE id_story IS NOT NULL AND created_at > now() - interval '30 hours'
    ORDER BY md5(id::text) LIMIT $1`, [NEWS]);
const grouping = [];
let started = Date.now();
for (const [i, {id}] of sample.entries()) {
    const [n] = await q(`SELECT id, lang, medium, title, description, title_figures, title_dense::text AS td, title_sparse::text AS ts,
        text_dense::text AS xd, COALESCE(published_at, created_at) AS at FROM articles WHERE id = $1`, [id]);
    // the stories closest by the stored titles (average over their members of other media or not)
    const stories = (await q(`
        SELECT m.id_story, AVG(-(m.title_dense <#> $2::halfvec) - $4::real * (m.title_sparse <#> $3::sparsevec)) AS raw
        FROM articles m WHERE m.id_story IS NOT NULL AND m.id <> $1 AND m.lang = $5
          AND COALESCE(m.published_at, m.created_at) >= $6::timestamptz - interval '48 hours' AND COALESCE(m.published_at, m.created_at) <= $6
        GROUP BY m.id_story ORDER BY raw DESC LIMIT $7`, [n.id, n.td, n.ts, T.sparse, n.lang, n.at, CANDIDATE_STORIES])).map(r => r.id_story);
    const members = await q(`
        SELECT * FROM (SELECT m.id_story, m.title, m.description, m.medium, m.title_figures, COALESCE(m.published_at, m.created_at) AS at,
                              m.title_dense::text AS td, m.title_sparse::text AS ts, m.text_dense::text AS xd,
                              row_number() OVER (PARTITION BY m.id_story ORDER BY md5(m.id::text)) AS k
                       FROM articles m WHERE m.id_story = ANY($1::int[]) AND m.id <> $2 AND m.lang = $3
                         AND COALESCE(m.published_at, m.created_at) >= $4::timestamptz - interval '48 hours'
                         AND COALESCE(m.published_at, m.created_at) <= $4) x WHERE k <= $5`, [stories, n.id, n.lang, n.at, MAX_MEMBERS]);
    const vectors = await embed([n.title, richText(n.title, n.description), ...members.flatMap(m => [m.title, richText(m.title, m.description)])]);
    const asNews = (row, td, ts, xd) => ({td, ts, xd, medium: row.medium, at: new Date(row.at).getTime(), figures: row.title_figures ?? []});
    const stored = asNews(n, dense(n.td), sparse(n.ts), dense(n.xd));
    const int8 = asNews(n, vectors[0].dense, vectors[0].sparse, vectors[1].dense);
    const storedMembers = members.map(m => ({story: m.id_story, ...asNews(m, dense(m.td), sparse(m.ts), dense(m.xd))}));
    const int8Members = members.map((m, k) => ({story: m.id_story, ...asNews(m, vectors[2 + 2 * k].dense, vectors[2 + 2 * k].sparse, vectors[3 + 2 * k].dense)}));
    const scores = stories.map(story => ({story,
        stored: storyScore(stored, storedMembers.filter(m => m.story === story)),
        int8: storyScore(int8, int8Members.filter(m => m.story === story))}));
    const decided = {stored: best(scores.map(s => ({story: s.story, score: s.stored.score}))), int8: best(scores.map(s => ({story: s.story, score: s.int8.score})))};
    const flips = scores.filter(s => (s.stored.score >= T.threshold) !== (s.int8.score >= T.threshold)
        || (s.stored.textAvg >= T.text) !== (s.int8.textAvg >= T.text)).length;
    const diffs = scores.filter(s => s.stored.score !== null && s.int8.score !== null).map(s => Math.abs(s.stored.score - s.int8.score));
    grouping.push({id, title: n.title, stories: stories.length, members: members.length, ...decided, flips, maxDiff: Math.max(0, ...diffs),
        close: scores.map(s => ({story: s.story, stored: s.stored.score, int8: s.int8.score, storedText: s.stored.textAvg, int8Text: s.int8.textAvg}))});
    if (i % 20 === 19) console.log(`grouping ${i + 1}/${sample.length} (${Math.round((Date.now() - started) / 1000)} s, ${embedded} texts embedded)`);
}
const same = grouping.filter(g => g.stored === g.int8).length;
out.grouping = {news: grouping.length, sameStory: same, joinedStored: grouping.filter(g => g.stored !== null).length,
    joinedInt8: grouping.filter(g => g.int8 !== null).length, flips: grouping.reduce((s, g) => s + g.flips, 0),
    maxScoreDiff: Math.max(...grouping.map(g => g.maxDiff)), meanMaxDiff: grouping.reduce((s, g) => s + g.maxDiff, 0) / grouping.length,
    differ: grouping.filter(g => g.stored !== g.int8)};
console.log(`grouping: same decision for ${same}/${grouping.length} news (joined a story: ${out.grouping.joinedStored} stored, ${out.grouping.joinedInt8} int8), ${out.grouping.flips} threshold crossings, max score change ${out.grouping.maxScoreDiff.toFixed(4)} (mean of the max ${out.grouping.meanMaxDiff.toFixed(4)})`);

// closest news to a query among candidate ids, both sides
const rerank = async (ids, query, limit) => {
    const rows = await q(`SELECT id, title, description FROM articles WHERE id = ANY($1::int[])`, [ids]);
    const vectors = await embed(rows.map(r => richText(r.title, r.description)));
    return rows.map((r, k) => ({id: r.id, score: dot(vectors[k].dense, query.dense) + 0.5 * sdot(vectors[k].sparse, query.sparse)}))
        .sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit).map(r => r.id);
};
const compare = (full, int8) => ({common: full.filter(id => int8.includes(id)).length,
    out: full.filter(id => !int8.includes(id)).map(id => full.indexOf(id) + 1)});

// 2. search by sentence (the sentences of halfvec-precision.mjs)
const SENTENCES = ["l'arbitrage vidéo en Ligue 1", 'les nouveaux modèles de voitures électriques', 'les cartes Pokémon',
    'the Artemis II astronauts of NASA', 'Premier League referee decisions', "the America's Cup sailing race",
    "le budget de l'État et la réforme des retraites en France", "les prix de l'immobilier en Suisse", 'les vendanges en Valais',
    'les incendies de forêt', 'the interest rate decision of the Federal Reserve', 'measles outbreaks',
    'the Swiss chocolate industry', 'new AI models for programming', 'Taylor Swift', 'du football mais pas le PSG',
    "l'intelligence artificielle à l'hôpital"];
const fullQueries = await embedWith(PORTS.torch, SENTENCES);
const int8Queries = await embed(SENTENCES);
const closest = (limit) => `SELECT id FROM articles WHERE embedded_at IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '7 days'
    ORDER BY -(text_dense <#> $1::halfvec) - 0.5 * (text_sparse <#> $2::sparsevec) DESC, id LIMIT ${limit}`;
const vec = (v) => `[${Array.from(v.dense).join(',')}]`;
out.search = [];
started = Date.now();
for (const [i, sentence] of SENTENCES.entries()) {
    const full = (await q(closest(120), [vec(fullQueries[i]), toSparsevec(fullQueries[i].sparse)])).map(r => r.id);
    const near = (await q(closest(120), [vec(int8Queries[i]), toSparsevec(int8Queries[i].sparse)])).map(r => r.id);
    const int8 = await rerank([...new Set([...full, ...near])], int8Queries[i], 80);
    out.search.push({sentence, ...compare(full.slice(0, 80), int8)});
    console.log(`${sentence.slice(0, 40).padEnd(40)} ${out.search.at(-1).common}/80 in common${out.search.at(-1).out.length ? `, out: rank ${out.search.at(-1).out.join(', ')}` : ''}`);
}
console.log(`search: ${Math.round((Date.now() - started) / 1000)} s`);

// 3. briefing
const interests = await q(`SELECT id, text, dense::text AS d, sparse::text AS s FROM profile_interests WHERE dense IS NOT NULL ORDER BY id`);
const int8Interests = await embed(interests.map(i => i.text));
const ranked = (limit) => `SELECT id FROM articles WHERE embedded_at IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '48 hours'
    ORDER BY -(text_dense <#> $1::halfvec) - 0.5 * (text_sparse <#> $2::sparsevec) DESC, id LIMIT ${limit}`;
out.briefing = [];
started = Date.now();
for (const [k, interest] of interests.entries()) {
    const full = (await q(ranked(50), [interest.d, interest.s])).map(r => r.id);
    const near = (await q(ranked(80), [vec(int8Interests[k]), toSparsevec(int8Interests[k].sparse)])).map(r => r.id);
    const int8 = await rerank([...new Set([...full, ...near])], int8Interests[k], 50);
    out.briefing.push({interest: interest.text, ...compare(full, int8)});
}
const swapped = out.briefing.reduce((s, b) => s + 50 - b.common, 0);
console.log(`briefing: ${interests.length} interests, top 50 identical for ${out.briefing.filter(b => b.common === 50).length}, ${swapped} news swapped in all (ranks ${out.briefing.flatMap(b => b.out).join(', ')}) (${Math.round((Date.now() - started) / 1000)} s)`);
out.embedded = {texts: embedded, seconds: Math.round(seconds)};

fs.mkdirSync('bench/data/int8', {recursive: true});
fs.writeFileSync(`bench/data/int8/decisions-${ENGINE}.json`, JSON.stringify(out, null, 1));
await c.end();
process.exit(0);
