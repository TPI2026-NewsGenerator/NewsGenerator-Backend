// Read only: the candidates of other angles of bench/data/angles-places.json (47 cards) whose title has
// a verb of denial (see contested.js): could a denial told in another story be found by the names?
//   node bench/denial-titles.mjs
import fs from 'node:fs';
import {hasDenial} from '../services/utils/contested.js';
const briefings = JSON.parse(fs.readFileSync(new URL('./data/angles-places.json', import.meta.url), 'utf8'));
let cards = 0, candidates = 0;
for (const briefing of briefings) for (const card of briefing.cards) {
    cards++;
    const found = card.others.filter(other => hasDenial(other.title ?? ''));
    candidates += card.others.length;
    if (found.length === 0) continue;
    console.log(`#${card.id} ${card.title}`);
    for (const other of found) console.log(`   ${other.named ? 'NAMED' : 'close'} ${String(other.at).slice(0, 10)} ${other.title}`);
}
console.log(`${cards} cards, ${candidates} candidates`);
