// The titles and descriptions stored before the fix of services/utils/parser.js (8.10.2026) with their
// named entities left ("L&rsquo;uomo &egrave;"), decoded as the parser does it now. Prints what it would
// change; with --write, changes it (search_text follows, the vectors stay)
//   node --env-file=.env bench/decode-stored.mjs [--write]
import pg from 'pg';
import {Parser} from '../services/utils/parser.js';

const write = process.argv.includes('--write');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const ENTITY = String.raw`&([A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);`;
let last = 0, seen = 0, changed = 0;
for (;;) {
    const {rows} = await pool.query(`SELECT id, title, description FROM articles
        WHERE id > $1 AND (title ~ $2 OR description ~ $2) ORDER BY id LIMIT 2000`, [last, ENTITY]);
    if (rows.length === 0) break;
    last = rows.at(-1).id;
    seen += rows.length;
    const updates = rows.map(row => ({id: row.id, title: Parser.Text(row.title), description: Parser.Text(row.description)}))
        .filter((row, i) => row.title !== rows[i].title || row.description !== rows[i].description);
    const shown = updates.find((row, i) => row.title !== rows.find(r => r.id === row.id).title && /&/.test(rows.find(r => r.id === row.id).title));
    if (seen <= 2000 && shown) {
        const before = rows.find(row => row.id === shown.id);
        console.log(`e.g. ${before.title}\n  -> ${shown.title}`);
    }
    changed += updates.length;
    if (write && updates.length > 0) {
        await pool.query(`UPDATE articles a SET title = u.title, description = u.description
            FROM jsonb_to_recordset($1::jsonb) AS u(id int, title text, description text) WHERE a.id = u.id`,
            [JSON.stringify(updates)]);
    }
}
console.log(`${seen} articles with an entity, ${changed} ${write ? 'changed' : 'to change (run with --write)'}`);
await pool.end();
