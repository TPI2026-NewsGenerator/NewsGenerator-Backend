// Read only: the name an official source is shown by, the AI's (as before 14.10.2026) or partyName's
// (services/utils/official-sources.js), for every party name searched (party_names) with an item.
// Prints the ones that change. The AI's other names are not kept in party_names: left out here.
//   node --env-file=.env bench/official-party-names.mjs
import pg from 'pg';
import {partyName} from '../services/utils/official-sources.js';

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT p.name, p.qid, e.label, e.names FROM party_names p JOIN entities e USING (qid) ORDER BY e.label`);
const changed = rows.filter(row => partyName(row.name, row.label, row.names ?? []) !== row.name);
console.log(`${rows.length} party names with an item, ${rows.length - changed.length} kept, ${changed.length} shown otherwise:`);
for (const row of changed) console.log(`  ${row.name}  ->  ${partyName(row.name, row.label, row.names ?? [])}   (${row.qid})`);
await c.end();
process.exit(0);
