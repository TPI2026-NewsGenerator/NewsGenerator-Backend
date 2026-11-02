// The titles of the cards of the briefings of the last days, made neutral (services/utils/neutral-titles.js):
// how many change, and every change, to be read. The AI only says which passages to take out, the code takes
// them out; a title is never rewritten.
//   node --env-file=.env bench/neutral-titles.mjs [days=14] [max=300] [batch=40]
import process from 'node:process';
import pg from 'pg';
import {neutralTitles} from '../services/utils/neutral-titles.js';
import {newUsage} from '../services/utils/ollama.js';

const [days = 14, max = 300, batch = 40] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [days]);
await client.end();
const titles = [...new Set(rows.flatMap(row => row.items.map(item => item.title)).filter(Boolean))]
    .sort(() => Math.random() - 0.5).slice(0, max);

const usage = newUsage();
const changed = [];
for (let i = 0; i < titles.length; i += batch) {
    const part = titles.slice(i, i + batch);
    const neutral = await neutralTitles(part, usage);
    part.forEach((title, j) => { if (neutral[j] !== title) changed.push([title, neutral[j]]); });
}
console.log(`${titles.length} titles, ${changed.length} changed (${(100 * changed.length / titles.length).toFixed(1)}%), tokens ${JSON.stringify(usage)}`);
for (const [before, after] of changed) console.log(`\n- ${before}\n+ ${after}`);
