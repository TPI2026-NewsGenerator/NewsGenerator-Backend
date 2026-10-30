// Live check of the ONNX embedder of the server (3.10.2026): is what it encodes now what PyTorch stored?
//  1. news embedded BEFORE the switch (vectors of PyTorch in the base) re-encoded by the live embedder
//  2. news embedded AFTER the switch (vectors of ONNX in the base) re-encoded: the same again?
//  3. hand-written sentences: a translation, the same event told otherwise, unrelated news
//  4. grouping: share of the news joining a story of several media, before and after the switch
// node --env-file=.env bench/onnx-live-check.mjs <switch ISO time> [news=150]
import process from 'node:process';
import pg from 'pg';
// as ingest-service.js (imported, it would start the ingestion's modules)
const richText = (title, description) => {
    const text = (description ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
    return text ? `${title}. ${text}` : title;
};

const SWITCH = new Date(process.argv[2]);
const N = Number(process.argv[3]) || 150;
const URL = 'http://192.168.1.135:8020';
const headers = {'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`};

const health = await (await fetch(`${URL}/health`)).json();
console.log('health:', JSON.stringify(health));

const embed = async (texts) => {
    const out = {dense: [], sparse: []};
    for (let k = 0; k < texts.length; k += 16) {
        const res = await fetch(`${URL}/embed`, {method: 'POST', headers, body: JSON.stringify({texts: texts.slice(k, k + 16)})});
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const body = await res.json();
        out.dense.push(...body.dense);
        out.sparse.push(...body.sparse);
    }
    return out;
};
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const sdot = (a, b) => { let s = 0; for (const k in a) if (k in b) s += a[k] * b[k]; return s; };
const scos = (a, b) => sdot(a, b) / Math.sqrt(sdot(a, a) * sdot(b, b) || 1);
const sparse = (text) => Object.fromEntries(text.slice(1, text.indexOf('}')).split(',').filter(Boolean)
    .map(pair => pair.split(':')).map(([i, w]) => [String(Number(i) - 1), Number(w)]));
const q = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))];
const f = (x) => x.toFixed(5);

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();

const compare = async (label, where) => {
    const rows = (await c.query(`
        SELECT title, description, title_dense::text AS td, title_sparse::text AS ts, text_dense::text AS xd, text_sparse::text AS xs
        FROM articles WHERE title_dense IS NOT NULL AND ${where} ORDER BY md5(id::text) LIMIT $2`, [SWITCH, N])).rows;
    const texts = rows.flatMap(r => [r.title, richText(r.title, r.description)]);
    const started = Date.now();
    const got = await embed(texts);
    const seconds = (Date.now() - started) / 1000;
    const d = [], s = [], same = [];
    rows.forEach((r, i) => {
        for (const [k, dv, sv] of [[2 * i, r.td, r.ts], [2 * i + 1, r.xd, r.xs]]) {
            d.push(dot(got.dense[k], JSON.parse(dv)));
            const stored = sparse(sv), now = got.sparse[k];
            s.push(scos(stored, now));
            const a = Object.keys(stored), b = new Set(Object.keys(now));
            same.push(a.length === b.size && a.every(t => b.has(t)) ? 1 : 0);
        }
    });
    console.log(`\n${label}: ${rows.length} news, ${texts.length} texts in ${seconds.toFixed(0)} s (${(texts.length / seconds).toFixed(1)} texts/s)`);
    console.log(`  dense cosine with the stored one   min ${f(Math.min(...d))}  1% ${f(q(d, 0.01))}  median ${f(q(d, 0.5))}`);
    console.log(`  sparse cosine with the stored one  min ${f(Math.min(...s))}  1% ${f(q(s, 0.01))}  median ${f(q(s, 0.5))}`);
    console.log(`  same words in the sparse vector    ${same.reduce((x, y) => x + y, 0)}/${same.length}`);
};
await compare('1. stored by PyTorch (before the switch)', 'embedded_at < $1 AND embedded_at > $1::timestamptz - interval \'20 hours\'');
await compare('2. stored by ONNX (after the switch)', 'embedded_at > $1::timestamptz + interval \'2 minutes\'');

const sentences = [
    ['Le Conseil fédéral relève le prix du timbre-poste', 'The Federal Council raises the price of postage stamps'],
    ['Erling Haaland marque un triplé contre Brighton', 'Triplé de Haaland, Manchester City écrase Brighton'],
    ['La BNS maintient son taux directeur à 0%', 'Les cartes Pokémon les plus chères vendues aux enchères'],
    ['Incendie de forêt en Valais: 200 hectares brûlés', 'Waldbrand im Wallis: 200 Hektar verbrannt'],
    ['Egypt vs Angola - Betting Tips', 'Togo vs Burundi - Betting Tips'],
];
const got = await embed(sentences.flat());
console.log('\n3. sentences (dense cosine / title score = dense + sparse as assign_stories, threshold 0.70)');
sentences.forEach(([a, b], i) => {
    const dd = dot(got.dense[2 * i], got.dense[2 * i + 1]), ss = sdot(got.sparse[2 * i], got.sparse[2 * i + 1]);
    console.log(`  ${dd.toFixed(3)} / ${(dd + ss).toFixed(3)}  "${a}"  ~  "${b}"`);
});

// the news of a window joined a story told by several media, by when they got their vectors
const grouped = async (from, to) => (await c.query(`
    SELECT count(*)::int AS news, count(*) FILTER (WHERE a.id_story IS NOT NULL)::int AS assigned,
           count(*) FILTER (WHERE (SELECT count(DISTINCT m.medium) FROM articles m WHERE m.id_story = a.id_story) >= 2)::int AS shared
    FROM articles a WHERE a.embedded_at >= $1 AND a.embedded_at < $2`, [from, to])).rows[0];
const after = await grouped(SWITCH, new Date());
const hours = (Date.now() - SWITCH) / 3600e3;
const before = await grouped(new Date(SWITCH - hours * 3600e3), SWITCH);
console.log(`\n4. grouping over ${hours.toFixed(1)} h each side`);
for (const [label, g] of [['before (PyTorch)', before], ['after (ONNX)', after]])
    console.log(`  ${label.padEnd(17)} ${g.news} news embedded, ${g.assigned} in a story, ${g.shared} (${(100 * g.shared / g.news).toFixed(1)}%) in a story of 2+ media`);
await c.end();
process.exit(0);
