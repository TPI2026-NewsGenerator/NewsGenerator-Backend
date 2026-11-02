// The parties of the official sources stored before 2.11.2026 have their English label alone for their names
// (331 of 335 items read): their labels in the other languages, their aliases and their short name are read
// from Wikidata now, as readChannels does for the next ones. Only an item with one name or none is changed
// (a followed item has its own, read for its page). Prints what it would change; with --write, changes it
//   node --env-file=.env bench/entity-names-backfill.mjs [--write]
import pg from 'pg';
import {readChannels} from '../services/utils/wikidata.js';

const write = process.argv.includes('--write');
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const {rows} = await pool.query(`SELECT qid, label FROM entities
    WHERE channels_at IS NOT NULL AND COALESCE(cardinality(names), 0) <= 1 ORDER BY qid`);
console.log(`${rows.length} items with their label alone`);

let changed = 0, shown = 0;
for (let i = 0; i < rows.length; i += 40) {
    const read = await readChannels(rows.slice(i, i + 40).map(row => row.qid));
    const more = read.filter(item => item.names.length > 1);
    for (const item of more.slice(0, Math.max(0, 5 - shown))) { console.log(`e.g. ${item.qid} ${item.label}: ${item.names.slice(0, 8).join(' | ')}`); shown++; }
    changed += more.length;
    if (write && more.length > 0) {
        await pool.query(`UPDATE entities e SET names = ARRAY(SELECT jsonb_array_elements_text(u.names))
            FROM jsonb_to_recordset($1::jsonb) AS u(qid text, names jsonb)
            WHERE e.qid = u.qid AND COALESCE(cardinality(e.names), 0) <= 1`, [JSON.stringify(more.map(({qid, names}) => ({qid, names})))]);
    }
}
console.log(`${changed} items ${write ? 'changed' : 'to change (run with --write)'}`);
await pool.end();
