//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: country-fa.mjs
//  Description: "{Country} FA", "Portuguese football federation": the names of football associations the tagger finds and the link
//               never made (defect 3 of the 11.11.2026 audit, see the decision log). Runs associationNamed (football-associations.js)
//               over every organisation of the database that holds a word of football body and counts what they are linked to now:
//               nothing, the same association, another item (to read by hand). Writes country-fa.sql for the user to run: the names
//               with no item get their association, linked_at now.
//               Read-only on the database.
//
//               node bench/federations/country-fa.mjs
//

import {writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {associationNames, associationNamed} from '../../services/utils/football-associations.js';

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, name, qid, seen, linked_at AS "linkedAt"
    FROM mentions
    WHERE kind = 'organization'
      AND key ~ '(^| )(fa|football association|football federation|soccer federation|soccer association)$'`);
console.log('organisations ending with a word of football body:', rows.length);

const names = associationNames();
const claimed = rows.map(row => ({...row, association: associationNamed(row.name)})).filter(row => row.association);
const by = (list, test) => list.filter(test);
const mentions = (list) => list.reduce((sum, row) => sum + row.seen, 0);
const unlinked = by(claimed, row => row.qid === null);
const same = by(claimed, row => row.qid === row.association);
const other = by(claimed, row => row.qid !== null && row.qid !== row.association);
console.log(`\nnames taken by associationNamed: ${claimed.length} (${mentions(claimed)} mentions)`);
console.log(`  with no item now: ${unlinked.length} names, ${mentions(unlinked)} mentions | already this association: ${same.length} names | linked to ANOTHER item: ${other.length} names`);

console.log('\nlinked to another item (read by hand):');
console.table(other.sort((a, b) => b.seen - a.seen).map(row => ({name: row.name, seen: row.seen, now: row.qid, words: row.association, association: names.get(row.association)})));

console.log('\nthe 60 names that will be linked, most seen first:');
console.table(unlinked.sort((a, b) => b.seen - a.seen).slice(0, 60).map(row => ({name: row.name, seen: row.seen, association: names.get(row.association), looked: row.linkedAt ? 'yes' : 'waiting'})));

// the names it leaves, to see what it misses and what it should leave
const left = rows.filter(row => !associationNamed(row.name) && row.qid === null).sort((a, b) => b.seen - a.seen).slice(0, 40);
console.log('\nending with a word of body, no item, taken by no rule (the 40 most seen):');
console.table(left.map(row => ({name: row.name, seen: row.seen})));

writeFileSync(new URL('./country-fa.sql', import.meta.url), `-- ${unlinked.length} names of an association by its country ("Japan FA") with no item (11.11.2026): linked to their association by the words (football-associations.js associationNamed), the ones looked for in Wikidata and left with none and the ones the link loop never reached (a name met rarely waits)\n`
    + `UPDATE mentions m SET qid = v.qid, linked_at = now() FROM (VALUES ${unlinked.map(row => `(${row.id}, '${row.association}')`).join(', ')}) AS v(id, qid) WHERE m.id = v.id AND m.qid IS NULL;\n`);
console.log(`\ncountry-fa.sql written: ${unlinked.length} names to link`);
await prisma.$disconnect();
