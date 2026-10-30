// The persons of one word linked to an item personItem (person-items.js) would no longer take: no human, or
// a label other than the word, or fewer than WORD_SITELINKS Wikipedias. Writes relink.sql for the user to
// run: qid null and linked_at kept (the card tells the family name, the answer personItem gives now); runs
// nothing on the database itself. Items from bench/link-types/items.json, the others read in Wikidata.
// node --env-file=.env bench/single-words/relink.mjs
import fs from 'node:fs';
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {WORD_SITELINKS} from '../../services/utils/person-items.js';

const file = new URL('../link-types/items.json', import.meta.url);
const items = JSON.parse(fs.readFileSync(file, 'utf8'));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key NOT LIKE '% %'`);
await db.end();
const missing = [...new Set(rows.map(row => row.qid))].filter(qid => !items[qid]);
for (let i = 0; i < missing.length; i += 10) {
    const part = missing.slice(i, i + 10);
    for (;;) {
        try {
            const read = new Map((await describeItems(part)).map(item => [item.qid, item]));
            for (const qid of part) items[qid] = read.get(qid) ?? {qid, missing: true};
            break;
        } catch (err) {
            if (!err.paused) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
}
fs.writeFileSync(file, JSON.stringify(items));
const keeps = (row) => {
    const item = items[row.qid];
    return item && !item.missing && item.human && mentionKey(item.label) === mentionKey(row.name) && item.links >= WORD_SITELINKS;
};
const again = rows.filter(row => items[row.qid] && !items[row.qid].missing && !keeps(row));
console.log(`${rows.length} persons of one word linked (${missing.length} items read now), ${again.length} to unlink, ${rows.length - again.length} kept`);
for (const row of again.sort((a, b) => b.seen - a.seen).slice(0, 25)) console.log(`${row.seen}\t${row.name} -> ${items[row.qid].label} (${items[row.qid].description}) ${items[row.qid].links} wikis`);
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} persons of one word linked to an item that is no human, not called so or in fewer than ${WORD_SITELINKS} Wikipedias: no link, the card tells the family name (21.10.2026)\n`
    + `UPDATE mentions SET qid = NULL WHERE kind = 'person' AND key NOT LIKE '% %' AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
