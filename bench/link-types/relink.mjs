// The persons of one word linked to an item that is no human (Zverev an asteroid, Dybala, Puigdemont a
// building, "researchers" the job): the full names were told at 0 of 430 (20.10.2026), the words alone at 51
// of 70 (bench/link-audit/humans.mjs), the rule of person-items.js refusing them for new names only. Reads
// every one of them in Wikidata and writes relink.sql for the user to run: qid null and linked_at kept,
// what the link loop would answer now (personItem: no human, no link), no name waiting for it again; runs
// nothing on the database itself. items.json keeps the answers.
// node --env-file=.env bench/link-types/relink.mjs
import fs from 'node:fs';
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';

const file = new URL('./items.json', import.meta.url);
const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key NOT LIKE '% %'`);
await db.end();

const qids = [...new Set(rows.map(row => row.qid))].filter(qid => !items[qid]);
for (let i = 0; i < qids.length; i += 10) {
    const part = qids.slice(i, i + 10);
    for (;;) {
        try {
            const read = new Map((await describeItems(part)).map(item => [item.qid, item]));
            for (const qid of part) items[qid] = read.get(qid) ?? {qid, missing: true};
            break;
        } catch (err) {
            if (!err.paused) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 30000) + 1000));
        }
    }
    if ((i / 10) % 20 === 0) fs.writeFileSync(file, JSON.stringify(items));
    await new Promise(resolve => setTimeout(resolve, 300));
}
fs.writeFileSync(file, JSON.stringify(items));
const again = rows.filter(row => items[row.qid] && !items[row.qid].missing && !items[row.qid].human);
const gone = rows.filter(row => items[row.qid]?.missing);
console.log(`${rows.length} persons of one word linked, ${again.length} to an item that is no human (${again.filter(row => row.seen >= 20).length} seen 20 times or more), ${gone.length} to an item Wikidata no longer has (left alone)`);
for (const row of again.sort((a, b) => b.seen - a.seen).slice(0, 40)) console.log(`${row.seen}\t${row.name} -> ${items[row.qid].label} (${items[row.qid].description})`);
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} persons of one word linked to an item that is no human: no link, as personItem answers (20.10.2026)\n`
    + `UPDATE mentions SET qid = NULL WHERE kind = 'person' AND key NOT LIKE '% %' AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
