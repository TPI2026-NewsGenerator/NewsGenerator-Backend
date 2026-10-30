// Read only: cleanTitle (services/utils/titles.js) on the news of the last day: how many titles change,
// the ends taken out per medium, and a sample to read by hand.  node --env-file=.env bench/titles-clean.mjs
import pg from 'pg';
import {cleanTitle, isCut} from '../services/utils/titles.js';

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT title, medium FROM articles WHERE created_at > now() - interval '1 day' AND title ~ ' [|–—-] '`);
const ends = new Map();
let changed = 0, cut = 0;
const sample = [];
for (const row of rows) {
    const clean = cleanTitle(row.title, row.medium);
    if (clean === row.title.trim()) continue;
    changed++;
    const end = `${row.medium} :: ${row.title.slice(clean.length).trim()}`;
    ends.set(end, (ends.get(end) ?? 0) + 1);
    if (Math.random() < 0.02 && sample.length < 40) sample.push(`${row.medium}: ${row.title}  =>  ${clean}`);
}
const {rows: [count]} = await c.query(`SELECT count(*) FROM articles WHERE created_at > now() - interval '1 day'`);
for (const row of (await c.query(`SELECT title FROM articles WHERE created_at > now() - interval '1 day' AND title ~ '(…|\.\.\.)$'`)).rows) if (isCut(row.title)) cut++;
await c.end();
console.log(`${count.count} news, ${rows.length} with a separator, ${changed} cleaned, ${cut} cut by their feed`);
console.log([...ends].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.ENDS ?? 45)).map(([end, n]) => `${n}\t${end}`).join('\n'));
console.log('\nsample:\n' + sample.join('\n'));
