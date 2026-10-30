// The score of one news (assign_stories) as written today (the similarities inside the averages:
// each vector read again per average) and computed once per row before them (OFFSET 0 keeps Postgres
// from folding the subquery into the averages), on the copies of halfvec-speed.mjs --keep
// node --env-file=.env bench/halfvec-speed2.mjs [news=15]
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
const NEWS = Number(process.argv[2]) || 15;
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
for (const table of ['bench_full', 'bench_half']) await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_id ON ${table} (id)`);
const src = fs.readFileSync('bench/halfvec-speed.mjs', 'utf8');
const body = src.slice(src.indexOf('const story = (table) => `') + 'const story = (table) => `'.length);
const today = body.slice(0, body.indexOf('`;'));
const once = today.replace(`AND COALESCE(m.published_at, m.created_at) >= n.at - interval '48 hours') pairs`,
    `AND COALESCE(m.published_at, m.created_at) >= n.at - interval '48 hours' OFFSET 0) pairs`);
if (once === today) throw new Error('rewrite not applied');
const variants = {full_today: ['bench_full', today], full_once: ['bench_full', once], half_today: ['bench_half', today], half_once: ['bench_half', once]};
const ids = (await q(`SELECT id FROM bench_full WHERE id_story IS NOT NULL AND created_at > now() - interval '24 hours' ORDER BY md5(id::text) LIMIT $1`, [NEWS])).map(r => r.id);
const times = Object.fromEntries(Object.keys(variants).map(v => [v, []]));
const answers = Object.fromEntries(Object.keys(variants).map(v => [v, []]));
for (const [i, id] of ids.entries()) {
    const names = Object.keys(variants);
    for (const name of i % 2 ? names.reverse() : names) {
        const [table, sql] = variants[name];
        const t = performance.now();
        const rows = await q(sql.replaceAll('${table}', table), [id]);
        times[name].push(performance.now() - t);
        answers[name].push(rows[0]?.id_story ?? null);
    }
    console.log(`${i + 1}/${ids.length}: ${Object.keys(variants).map(v => `${v} ${Math.round(times[v].at(-1))}`).join(' | ')} ms`);
}
const median = (list) => { const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]); };
console.table(Object.fromEntries(Object.keys(variants).map(v => [v, {median_ms: median(times[v]),
    same_story_as_full_today: answers[v].filter((s, k) => s === answers.full_today[k]).length + '/' + ids.length}])));
fs.writeFileSync('bench/data/halfvec/speed2.json', JSON.stringify({ids, times, answers}, null, 1));
await c.end();
process.exit(0);
