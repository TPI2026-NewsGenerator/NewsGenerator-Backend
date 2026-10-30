// The organisations linked now that organizationItem (organization-items.js) would send to the AI: the sites
// naming them are of another country than their item (country-names.js ofOtherCountry). Reads the countries
// of the items kept in item_countries (the ones not read yet are left), writes relink.sql for the user to run
// (qid and linked_at null: looked for again by the link loop, which asks the AI for each); runs nothing on
// the database itself. node --env-file=.env bench/org-country/relink.mjs [seen at least, 10]
import fs from 'node:fs';
import pg from 'pg';
import {ofOtherCountry} from '../../services/utils/country-names.js';

const SEEN = Number(process.argv[2] ?? 10);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT m.id, m.name, m.lang, m.qid, m.seen, c.country FROM mentions m JOIN item_countries c ON c.qid = m.qid
    WHERE m.kind = 'organization' AND m.seen >= $1 AND c.country IS NOT NULL AND NOT c.international ORDER BY m.seen DESC`, [SEEN]);
console.log(`${rows.length} organisations seen ${SEEN} times or more linked to an item with a country`);
const again = [];
for (const [i, row] of rows.entries()) {
    const {rows: sites} = await db.query(`SELECT regexp_replace(lower(split_part(a.link, '/', 3)), '^www\.', '') AS site, count(*)::int AS news
        FROM article_mentions am JOIN articles a ON a.id = am.id_article WHERE am.id_mention = $1 GROUP BY 1`, [row.id]);
    if (ofOtherCountry(sites, row.country)) again.push(row);
    if (i % 2000 === 0 && i > 0) console.log(`${i} read, ${again.length} to ask again`);
}
await db.end();
console.log(`${again.length} to ask again, ${again.filter(row => row.seen >= 100).length} seen 100 times or more`);
for (const row of again.slice(0, 60)) console.log(`${row.seen}\t${row.name} [${row.lang}] ${row.qid} item ${row.country}`);
fs.writeFileSync(new URL('./relink.sql', import.meta.url), `-- ${again.length} organisations linked to an item of another country than the sites naming them: asked again, the AI reads their titles (21.10.2026)\n`
    + `UPDATE mentions SET qid = NULL, linked_at = NULL WHERE kind = 'organization' AND id = ANY(ARRAY[${again.map(row => row.id).join(',')}]);\n`);
