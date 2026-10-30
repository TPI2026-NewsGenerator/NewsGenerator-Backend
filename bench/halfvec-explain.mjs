// the plan of the score of one news (assign_stories) on the copies of halfvec-speed.mjs --keep
import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const id = (await c.query(`SELECT id FROM bench_full WHERE id_story IS NOT NULL AND lang = 'en' ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
const src = fs.readFileSync('bench/halfvec-speed.mjs', 'utf8');
const body = src.slice(src.indexOf('const story = (table) => `') + 'const story = (table) => `'.length);
const story = body.slice(0, body.indexOf('`;'));
for (const table of ['bench_full', 'bench_half']) {
    const plan = (await c.query(`EXPLAIN (ANALYZE, BUFFERS) ${story.replaceAll('${table}', table)}`, [id])).rows.map(r => r['QUERY PLAN']);
    console.log(`--- ${table}\n${plan.join('\n')}`);
}
await c.end();
