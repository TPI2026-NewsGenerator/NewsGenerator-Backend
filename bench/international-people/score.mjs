//
//  Author: Fabian Rostello
//  Date: 19.10.2026
//  File: score.mjs
//  Description: Right and wrong cards of each rule of bench.mjs against truth.json (judged by hand):
//               only the cards where the rules differ are judged, the others count the same for all
//               node bench/international-people/score.mjs
//

import fs from 'node:fs';

const results = JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url)));
const truth = JSON.parse(fs.readFileSync(new URL('./truth.json', import.meta.url)));
const asSet = (codes) => [...codes].sort().join('·');
const differing = results.filter(card => new Set(Object.values(card.rules).map(asSet)).size > 1);
const unjudged = differing.filter(card => !truth[card.storyId]);
if (unjudged.length > 0) console.log(`not judged: ${unjudged.map(card => card.storyId).join(', ')}`);
const rules = Object.keys(results[0].rules);
console.log(`${results.length} cards naming an international body, ${differing.length} where the rules differ (judged)\n`);
for (const rule of rules) {
    const wrong = differing.filter(card => truth[card.storyId] && !truth[card.storyId].includes(asSet(card.rules[rule])));
    console.log(`${rule.padEnd(15)} right ${differing.length - unjudged.length - wrong.length}  wrong ${wrong.length}   ${wrong.map(card => `${card.storyId}:${asSet(card.rules[rule]) || '-'}`).join(' ')}`);
}
