// The word alone with no link of its own (the card tells it, see surnames.mjs) against keeping the link when the
// label of the item is the word and it is in `least` Wikipedias at least. Final result per name: right (the
// person at the end), wrong, none (no link: a right one lost, or no wrong one left). The card's answers judged
// by hand to be another person than the news name: CARD_WRONG. node bench/single-words/combine.mjs
import fs from 'node:fs';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const sample = read('./sample.json');
const truth = read('./truth.json');
const card = read('./surnames.json');
// Bolsonaro and Koumas (a namesake of the family met more), Carnevali (a painter "Carnovali"), Eduardo, Clark,
// Coulibaly (namesakes of other sports)
const CARD_WRONG = new Set(['Bolsonaro', 'Koumas', 'Carnevali', 'Eduardo', 'Clark', 'Coulibaly']);
const bare = (text) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const own = (e, least) => bare(e.label) === bare(e.name) && e.links >= least;
for (const least of [Infinity, 60, 40, 30, 20, 10, 1]) {
    const out = {right: 0, wrong: 0, none: 0};
    for (const [i, e] of sample.entries()) {
        if (truth[i] === '?') continue;
        if (own(e, least)) out[truth[i] === 'R' ? 'right' : 'wrong']++;
        else if (!card[i]) out.none++;
        else if (truth[i] === 'R' && card[i] === e.qid) out.right++;
        else out[CARD_WRONG.has(e.name) ? 'wrong' : 'right']++;
    }
    console.log(`${least === Infinity ? 'no own link' : `own link if label is the name, ${least}+ wikis`}: ${JSON.stringify(out)}`);
}
console.log(`now: right ${truth.filter(t => t === 'R').length}, wrong ${truth.filter(t => t === 'W').length}`);
