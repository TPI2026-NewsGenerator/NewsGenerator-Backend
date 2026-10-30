// Do the vectors of bge-m3 in int8 say what the stored ones say? On real news of stories of several
// media, each engine of bench/int8/embedder.py (torch = the server's, onnx fp32, int8, int8pc) embeds
// the title and the text (title + start of the description) of each news as the ingestion does, and is
// compared with the vectors stored by the server:
//  1. each vector against its stored one: cosine of the dense, cosine of the sparse
//  2. the likeness of pairs as assign_stories computes it (titles: dense + sparse, texts: dense) for
//     pairs of one story, pairs of the closest other story, random pairs: how much it moves, and how
//     many pairs cross the thresholds 0.70 (titles) and 0.6 (texts)
// node --env-file=.env bench/int8-fidelity.mjs [stories=150]   -> bench/data/int8/fidelity.json
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const STORIES = Number(process.argv[2]) || 150;
const PORTS = {torch: 8030, onnx: 8031, int8: 8032, int8pc: 8033, int8x: 8034};
// ENGINES=int8x,int8 to compare only some of them
const ENGINES = Object.fromEntries(Object.entries(PORTS).filter(([e]) => !process.env.ENGINES || process.env.ENGINES.split(',').includes(e)));
const T = {threshold: 0.70, sparse: 1, text: 0.6};
const DESCRIPTION_CHARS = 400;      // as ingest-service.js
const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS);
    return text ? `${title}. ${text}` : title;
};

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const rows = (await c.query(`
    WITH s AS (SELECT a.id_story FROM articles a
               WHERE a.id_story IS NOT NULL AND a.created_at > now() - interval '30 hours'
               GROUP BY a.id_story HAVING count(DISTINCT a.medium) >= 2 ORDER BY md5(a.id_story::text) LIMIT $1)
    SELECT a.id, a.id_story, a.lang, a.title, a.description, a.title_dense::text AS td, a.title_sparse::text AS ts,
           a.text_dense::text AS xd, a.text_sparse::text AS xs
    FROM s, LATERAL (SELECT * FROM articles a WHERE a.id_story = s.id_story ORDER BY md5(a.id::text) LIMIT 3) a`, [STORIES])).rows;
await c.end();

const dense = (text) => Float64Array.from(JSON.parse(text));
// "{12:0.3,...}/250002", index = token id + 1 (see toSparsevec)
const sparse = (text) => Object.fromEntries(text.slice(1, text.indexOf('}')).split(',').filter(Boolean)
    .map(pair => pair.split(':')).map(([i, w]) => [String(Number(i) - 1), Number(w)]));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const sdot = (a, b) => { let s = 0; for (const k in a) if (k in b) s += a[k] * b[k]; return s; };
const scos = (a, b) => sdot(a, b) / Math.sqrt(sdot(a, a) * sdot(b, b) || 1);

const news = rows.map(r => ({id: r.id, story: r.id_story, lang: r.lang, title: r.title, text: richText(r.title, r.description),
    stored: {td: dense(r.td), ts: sparse(r.ts), xd: dense(r.xd), xs: sparse(r.xs)}}));
console.log(`${news.length} news of ${new Set(news.map(n => n.story)).size} stories`);

// the pairs: of one story, each news with the closest news of another story of its language (by the
// stored vectors), and with a random one of its language
const titleScore = (a, b) => dot(a.td, b.td) + T.sparse * sdot(a.ts, b.ts);
const pairs = [];
for (const [i, a] of news.entries()) {
    for (const [j, b] of news.entries()) if (j > i && b.story === a.story) pairs.push({i, j, kind: 'same story'});
    const others = news.map((b, j) => ({b, j})).filter(({b}) => b.story !== a.story && b.lang === a.lang);
    if (others.length === 0) continue;
    const closest = others.reduce((x, y) => titleScore(a.stored, y.b.stored) > titleScore(a.stored, x.b.stored) ? y : x);
    pairs.push({i, j: closest.j, kind: 'closest other story'});
    pairs.push({i, j: others[(i * 7919) % others.length].j, kind: 'random'});
}

const embed = async (port, texts) => {
    const out = {dense: [], sparse: [], seconds: 0};
    for (let k = 0; k < texts.length; k += 32) {
        const res = await fetch(`http://127.0.0.1:${port}/embed`, {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({texts: texts.slice(k, k + 32)}), signal: AbortSignal.timeout(30 * 60e3)});
        const body = await res.json();
        out.dense.push(...body.dense.map(v => Float64Array.from(v)));
        out.sparse.push(...body.sparse);
        out.seconds += body.seconds;
    }
    return out;
};

const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))];
const round = (x, d = 5) => Number(x.toFixed(d));
const out = {news: news.length, pairs: pairs.length, engines: {}};
for (const [engine, port] of Object.entries(ENGINES)) {
    const texts = news.flatMap(n => [n.title, n.text]);
    const got = await embed(port, texts);
    news.forEach((n, k) => {
        n[engine] = {td: got.dense[2 * k], ts: got.sparse[2 * k], xd: got.dense[2 * k + 1], xs: got.sparse[2 * k + 1]};
    });
    const cos = {titleDense: news.map(n => dot(n.stored.td, n[engine].td)), textDense: news.map(n => dot(n.stored.xd, n[engine].xd)),
        titleSparse: news.map(n => scos(n.stored.ts, n[engine].ts)), textSparse: news.map(n => scos(n.stored.xs, n[engine].xs))};
    const moves = {};
    for (const kind of ['same story', 'closest other story', 'random']) {
        const of = pairs.filter(p => p.kind === kind);
        const title = of.map(p => [titleScore(news[p.i].stored, news[p.j].stored), titleScore(news[p.i][engine], news[p.j][engine])]);
        const text = of.map(p => [dot(news[p.i].stored.xd, news[p.j].stored.xd), dot(news[p.i][engine].xd, news[p.j][engine].xd)]);
        const diff = (list) => list.map(([a, b]) => Math.abs(a - b));
        moves[kind] = {pairs: of.length,
            titleMean: round(diff(title).reduce((s, d) => s + d, 0) / of.length), titleMax: round(Math.max(...diff(title))),
            textMean: round(diff(text).reduce((s, d) => s + d, 0) / of.length), textMax: round(Math.max(...diff(text))),
            titleCross: title.filter(([a, b]) => (a >= T.threshold) !== (b >= T.threshold)).length,
            textCross: text.filter(([a, b]) => (a >= T.text) !== (b >= T.text)).length,
            nearTitle: title.filter(([a]) => Math.abs(a - T.threshold) < 0.05).length};
    }
    out.engines[engine] = {seconds: round(got.seconds, 1), textsPerSecond: round(texts.length / got.seconds, 2),
        cosine: Object.fromEntries(Object.entries(cos).map(([k, v]) => [k, {mean: round(v.reduce((s, x) => s + x, 0) / v.length), p1: round(quantile(v, 0.01)), min: round(Math.min(...v))}])),
        moves};
    console.log(`\n${engine}: ${texts.length} texts in ${got.seconds.toFixed(1)} s`);
    for (const [k, v] of Object.entries(out.engines[engine].cosine)) console.log(`  cosine ${k.padEnd(12)} mean ${v.mean}  p1 ${v.p1}  min ${v.min}`);
    for (const [k, v] of Object.entries(moves)) console.log(`  ${k.padEnd(20)} ${v.pairs} pairs: title moves ${v.titleMean} (max ${v.titleMax}), ${v.titleCross} cross 0.70 (${v.nearTitle} within 0.05); text moves ${v.textMean} (max ${v.textMax}), ${v.textCross} cross 0.6`);
}

fs.mkdirSync('bench/data/int8', {recursive: true});
fs.writeFileSync(`bench/data/int8/fidelity${process.env.ENGINES ? `-${process.env.ENGINES.replace(/,/g, '-')}` : ''}.json`, JSON.stringify(out, null, 1));
process.exit(0);
