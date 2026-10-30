// the plan of split-mixed-stories.mjs, each target story shown by two of its titles
import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
for (const line of fs.readFileSync('bench/data/matchups/split-plan.txt', 'utf8').split('\n')) {
    const m = line.match(/news "(.*)" -> #(\d+)$/);
    if (!m) continue;
    const titles = (await c.query('SELECT title FROM articles WHERE id_story = $1 ORDER BY id DESC LIMIT 2', [Number(m[2])])).rows.map(r => r.title.slice(0, 55));
    console.log(`${m[1].slice(0, 45).padEnd(45)} -> #${m[2]}: ${titles.join(' // ')}`);
}
await c.end();
