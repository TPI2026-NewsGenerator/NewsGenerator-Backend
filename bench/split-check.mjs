// the news moved by split-mixed-stories.mjs: are they in the story planned?
import fs from 'node:fs';
import pg from 'pg';
const file = process.argv[2];
const {plan} = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const now = new Map((await c.query('SELECT id, id_story FROM articles WHERE id = ANY($1)', [plan.flatMap(p => p.news)])).rows.map(r => [r.id, r.id_story]));
const right = plan.flatMap(p => p.news.map(id => now.get(id) === p.to)).filter(Boolean).length;
const threaded = (await c.query('SELECT count(*) FILTER (WHERE threaded_at >= grouped_at)::int AS done, count(*)::int AS all FROM stories WHERE id = ANY($1)',
    [[...new Set(plan.flatMap(p => [p.story, p.to]))]])).rows[0];
console.log(`${right}/${now.size} news in the story planned; stories touched with their thread judged again: ${threaded.done}/${threaded.all}`);
await c.end();
