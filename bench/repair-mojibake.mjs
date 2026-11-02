// The titles and descriptions stored before the fix of services/utils/parser.js (2.11.2026) that a feed wrote
// in UTF-8 twice over ("Ghanaâ\u0080\u0099s" of ghanasoccernet.com), put back as they were (see
// services/utils/mojibake.js), and the cards of the briefings already written that carry them. Prints what it
// would change; with --write, changes it (search_text follows, the vectors stay)
//   node --env-file=.env bench/repair-mojibake.mjs [--write] [--days 30]   (days: only the news of the last days)
import pg from 'pg';
import {repairMojibake} from '../services/utils/mojibake.js';

const write = process.argv.includes('--write');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || null;
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
// a first byte of UTF-8 as a character, then what a byte after it shows read as ISO-8859-1 or Windows-1252
const BROKEN = String.raw`[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]`;

let last = 0, seen = 0, changed = 0, shown = 0;
for (;;) {
    const {rows} = await pool.query(`SELECT id, title, description FROM articles
        WHERE id > $1 AND (title ~ $2 OR description ~ $2) AND ($3::int IS NULL OR created_at > now() - make_interval(days => $3::int))
        ORDER BY id LIMIT 2000`, [last, BROKEN, days]);
    if (rows.length === 0) break;
    last = rows.at(-1).id;
    seen += rows.length;
    const updates = rows.map(row => ({id: row.id, title: repairMojibake(row.title), description: repairMojibake(row.description), was: row}))
        .filter(row => row.title !== row.was.title || row.description !== row.was.description);
    for (const row of updates.filter(row => row.title !== row.was.title).slice(0, Math.max(0, 3 - shown))) { console.log(`e.g. ${row.was.title}\n  -> ${row.title}`); shown++; }
    changed += updates.length;
    if (write && updates.length > 0) {
        await pool.query(`UPDATE articles a SET title = u.title, description = u.description
            FROM jsonb_to_recordset($1::jsonb) AS u(id int, title text, description text) WHERE a.id = u.id`,
            [JSON.stringify(updates.map(({id, title, description}) => ({id, title, description})))]);
    }
}
console.log(`${seen} articles read, ${changed} ${write ? 'changed' : 'to change (run with --write)'}`);

const briefings = await pool.query(`SELECT id, items FROM briefings WHERE items::text ~ $1`, [BROKEN]);
let cards = 0;
for (const row of briefings.rows) {
    const text = JSON.stringify(row.items);
    const repaired = repairMojibake(text);
    if (repaired === text) continue;
    cards++;
    if (write) await pool.query('UPDATE briefings SET items = $2::jsonb WHERE id = $1', [row.id, repaired]);
}
console.log(`${briefings.rows.length} briefings read, ${cards} ${write ? 'changed' : 'to change (run with --write)'}`);
await pool.end();
