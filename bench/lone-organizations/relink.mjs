// The organisations linked to an item organizationItem (organization-items.js) would no longer take without
// asking the AI: a human, a place (wikidata.js isPlace), a work (P577), in fewer than LONE_SITELINKS
// Wikipedias (items.json). Some were chosen by the AI among several items: asked again, it chooses the same.
// Writes relink.sql for the user to run (qid and linked_at null: looked for again by the link loop); runs
// nothing on the database itself. node --env-file=.env bench/lone-organizations/relink.mjs
import fs from 'node:fs';
import pg from 'pg';
import {LONE_SITELINKS} from '../../services/utils/organization-items.js';
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url)));
// as isPlace of wikidata.js, on the properties read by items.mjs
const BODY_PROPERTIES = ['P159', 'P118', 'P641', 'P452', 'P112', 'P1454', 'P749', 'P488', 'P169', 'P1128', 'P414', 'P127', 'P355'];
const has = (item, property) => item.props.includes(property);
const place = (item) => !has(item, 'P297') && (has(item, 'P1082') || (has(item, 'P625') && !BODY_PROPERTIES.some(property => has(item, property)))
    || item.p31.includes('Q486972'));
const refused = (item) => item.p31.includes('Q5') || place(item) || has(item, 'P577') || item.links < LONE_SITELINKS;

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, name, qid, seen FROM mentions WHERE kind = 'organization' AND qid IS NOT NULL`);
await db.end();
const again = rows.filter(row => items[row.qid] && !items[row.qid].missing && refused(items[row.qid]));
const why = (item) => item.p31.includes('Q5') ? 'human' : place(item) ? 'place' : has(item, 'P577') ? 'work' : 'few Wikipedias';
const counts = {};
again.forEach(row => { counts[why(items[row.qid])] = (counts[why(items[row.qid])] ?? 0) + 1; });
console.log(`${again.length} of ${rows.length} organisations, ${again.filter(row => row.seen >= 20).length} seen 20 times or more;`, counts);
console.log('most met:', again.sort((a, b) => b.seen - a.seen).slice(0, 25).map(row => `${row.name} (${row.seen}, ${why(items[row.qid])}: ${items[row.qid].description})`).join('\n  '));
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} organisations linked to an item organizationItem asks the AI for now: a human, a place, a work, in fewer than ${LONE_SITELINKS} Wikipedias (20.10.2026)\n`
    + `UPDATE mentions SET qid = NULL, linked_at = NULL WHERE kind = 'organization' AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
