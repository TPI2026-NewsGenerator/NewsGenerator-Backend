// Of the persons linked, how many to an item that is no human, on a random sample (read only):
// all, a word alone, a full name. node --env-file=.env bench/link-audit/humans.mjs [sample, 500]
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';
const SAMPLE = Number(process.argv[2] ?? 500);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows: [total]} = await db.query(`SELECT count(*) FILTER (WHERE key LIKE '% %') AS full, count(*) FILTER (WHERE key NOT LIKE '% %') AS single FROM mentions WHERE kind = 'person' AND qid IS NOT NULL`);
const {rows} = await db.query(`SELECT id, name, key, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND seen >= 3 ORDER BY random() LIMIT $1`, [SAMPLE]);
await db.end();
const humans = new Map();
for (let i = 0; i < rows.length; i += 10) {
    for (const item of await describeItems(rows.slice(i, i + 10).map(row => row.qid))) humans.set(item.qid, item);
    await new Promise(resolve => setTimeout(resolve, 300));
}
const stat = {full: [0, 0], single: [0, 0]};
const bad = [];
for (const row of rows) {
    const item = humans.get(row.qid);
    if (!item) continue;
    const kind = row.key.includes(' ') ? 'full' : 'single';
    stat[kind][0]++;
    if (!item.human) { stat[kind][1]++; bad.push(`${row.seen}\t${row.name} -> ${item.label} (${item.description}) ${item.links} wikis`); }
}
console.log(`persons linked: ${total.full} full names, ${total.single} words alone`);
console.log(`sample ${rows.length} (seen >= 3): full ${stat.full[1]} of ${stat.full[0]} no human, single ${stat.single[1]} of ${stat.single[0]}`);
console.log(bad.slice(0, 40).join('\n'));
