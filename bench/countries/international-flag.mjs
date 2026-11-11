// Which cards of the judged sample name an item Wikidata flags as an international body (item_countries.international), against the names FIFA/UEFA/CAF/AFC...:
// the rule "a card that names an international body keeps its first country only" reads that flag. Read only.   node --env-file=.env bench/countries/international-flag.mjs
import {readFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';

const cards = JSON.parse(readFileSync('bench/data/countries/dataset.json', 'utf8'));
const qids = [...new Set(cards.flatMap(card => card.names.map(name => name.qid).filter(Boolean)))];
const rows = await prisma.$queryRawUnsafe('SELECT qid, international FROM item_countries WHERE qid = ANY($1::text[])', qids);
const flagged = new Set(rows.filter(row => row.international).map(row => row.qid));
const BODY = /^(FIFA|UEFA|CAF|AFC|CONMEBOL|CONCACAF|OFC|IOC|UN|ONU|FIFPRO)$/i;
let both = 0, onlyFlag = 0, onlyName = 0;
for (const card of cards) {
    const byFlag = card.names.some(name => name.qid && flagged.has(name.qid));
    const byName = card.names.some(name => BODY.test(name.name.trim()));
    if (byFlag && byName) both++;
    else if (byFlag) { onlyFlag++; console.log(`  flag only  [${card.id}] ${card.names.filter(name => flagged.has(name.qid)).map(name => name.name).join(', ')} | ${(card.titleTranslation ?? card.title).slice(0, 60)}`); }
    else if (byName) { onlyName++; console.log(`  name only  [${card.id}] ${card.names.filter(name => BODY.test(name.name.trim())).map(name => `${name.name}(${name.qid ?? 'no item'})`).join(', ')} | ${(card.titleTranslation ?? card.title).slice(0, 60)}`); }
}
console.log(`${qids.length} items, ${flagged.size} flagged international: ${[...flagged].join(' ')}\ncards by the flag and the names ${both}, by the flag only ${onlyFlag}, by the names only ${onlyName}`);
await prisma.$disconnect();
