// speed of the embedder of EMBEDDER_URL on real news, and its vectors against another embedder's
// EMBEDDER_URL=http://host:8020 node --env-file=.env bench/embed-speed.mjs [count=256] [other url]
import pg from 'pg';
import {embed} from '../services/utils/embedder.js';
import {richText} from '../services/ingest-service.js';
const count = Number(process.argv[2]) || 256;
const other = process.argv[3];
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query('SELECT title, description FROM articles ORDER BY id DESC LIMIT $1', [count]);
await c.end();
const texts = rows.flatMap(r => [r.title, richText(r.title, r.description)]);
const started = Date.now();
const vectors = await embed(texts);
const seconds = (Date.now() - started) / 1000;
console.log(`${process.env.EMBEDDER_URL}: ${texts.length} texts in ${seconds.toFixed(1)} s, ${(texts.length / seconds).toFixed(1)} texts/s`);
if (other) {
    const res = await fetch(`${other}/embed`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`},
        body: JSON.stringify({texts: texts.slice(0, 32)})});
    const {dense} = await res.json();
    const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    const sims = dense.map((v, i) => cos(v, Array.from(vectors[i].dense)));
    console.log(`against ${other}: cosine min ${Math.min(...sims).toFixed(6)}`);
}
process.exit(0);
