// The news grouped in stories, with their vectors, to replay assign_stories offline (bench/story-drift.py)
// node bench/story-drift-export.mjs  ->  bench/data/story-drift/{meta.json, title_dense.f32, text_dense.f32, title_sparse.json}
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const OUT = 'bench/data/story-drift';
fs.mkdirSync(OUT, {recursive: true});
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const meta = [], sparse = [];
const titleDense = fs.openSync(`${OUT}/title_dense.f32`, 'w'), textDense = fs.openSync(`${OUT}/text_dense.f32`, 'w');
const write = (fd, text) => { const a = Float32Array.from(JSON.parse(text)); fs.writeSync(fd, Buffer.from(a.buffer)); };
let last = 0;
for (;;) {
    const {rows} = await c.query(`
        SELECT id, id_story, lang, link, title, medium, title_figures,
               extract(epoch FROM COALESCE(published_at, created_at)) AS at, extract(epoch FROM created_at) AS created,
               title_dense::text td, title_sparse::text ts, text_dense::text xd
        FROM articles WHERE id_story IS NOT NULL AND id > $1 ORDER BY id LIMIT 2000`, [last]);
    if (rows.length === 0) break;
    for (const r of rows) {
        meta.push({id: r.id, story: r.id_story, lang: r.lang, link: r.link, title: r.title, medium: r.medium,
                   figures: r.title_figures ?? [], at: Number(r.at), created: Number(r.created)});
        write(titleDense, r.td); write(textDense, r.xd);
        // '{12:0.3,45:0.1}/250002'
        sparse.push(Object.fromEntries(r.ts.slice(1, r.ts.indexOf('}')).split(',').filter(Boolean).map(kv => kv.split(':').map(Number))));
    }
    last = rows.at(-1).id;
    process.stdout.write(`\r${meta.length}`);
}
fs.closeSync(titleDense); fs.closeSync(textDense);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
fs.writeFileSync(`${OUT}/title_sparse.json`, JSON.stringify(sparse));
console.log(`\n${meta.length} news`);
await c.end();
