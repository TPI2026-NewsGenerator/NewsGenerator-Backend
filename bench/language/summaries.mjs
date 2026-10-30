// the summaries of the briefings written in French that hold English words
import 'dotenv/config';
import pg from 'pg';
const EN = new Set('the of and is in for on to with by not who that this his her are more from at as its was known'.split(' '));
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT b.id, it->>'summary' AS summary FROM briefings b, jsonb_array_elements(b.items) it WHERE it->>'summary' IS NOT NULL AND it->>'summary' <> ''`);
await client.end();
let french = 0;
for (const r of rows) {
    const words = r.summary.toLowerCase().match(/[\p{L}]+/gu) ?? [];
    if (!words.some(w => ['le', 'la', 'les', 'des'].includes(w))) continue;
    french++;
    const english = words.filter(w => EN.has(w) && !['on', 'in', 'as', 'est'].includes(w));
    if (english.length >= 2) console.log(r.id, english.join(','), '|', r.summary.replace(/\s+/g, ' ').slice(0, 220));
}
console.log(`${rows.length} summaries, ${french} in French`);
