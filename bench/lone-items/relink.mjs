// The persons of a full name linked to an item personItem (person-items.js) would no longer take without
// asking the AI: no human, in no Wikipedia, a family name after a particle under 10 (items.json). Writes
// relink.sql for the user to run (linked_at null: looked for again); runs nothing on the database itself
// node --env-file=.env bench/lone-items/relink.mjs
import fs from 'node:fs';
import pg from 'pg';
import {familyName} from '../../services/utils/person-items.js';
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url)));
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key LIKE '% %'`);
await db.end();
const again = rows.filter(row => {
    const item = items[row.qid];
    return item && !item.missing && (!item.human || item.links === 0 || (familyName(row.name) && item.links < 10));
});
console.log(`${again.length} of ${rows.length} persons, ${again.filter(row => row.seen >= 20).length} seen 20 times or more`);
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} persons linked to the one item called so that personItem asks the AI for or refuses (20.10.2026)\n`
    + `UPDATE mentions SET qid = NULL, linked_at = NULL WHERE kind = 'person' AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
