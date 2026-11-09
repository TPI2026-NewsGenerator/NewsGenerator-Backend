//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: duplicate-live.mjs
//  Description: The fold of the cards of one news of the server (services/utils/card-merge.js) run for real, on the saved briefings of the
//               measure of bench/duplicate-cards.mjs (its dataset and its judged pairs, bench/data/duplicates): the pairs the two readers
//               agree on against the verdicts of the two judges, and what the fold makes of the real cards. Nothing is saved
//
//  node --env-file=.env bench/duplicate-live.mjs
//

import process from 'node:process';
import {readFileSync} from 'node:fs';
import {prisma} from '../config/db.js';
import {newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {foldCards, sameNewsGroups} from '../services/utils/card-merge.js';

const DIR = 'bench/data/duplicates';
const dataset = JSON.parse(readFileSync(`${DIR}/dataset.json`, 'utf8'));
const final = JSON.parse(readFileSync(`${DIR}/final.json`, 'utf8'));
const verdictOf = new Map(final.map(one => [`${one.briefing}:${one.a}-${one.b}`, one.verdict]));
const rows = await prisma.$queryRawUnsafe('SELECT id, items FROM briefings WHERE id = ANY($1::int[])', dataset.map(briefing => briefing.id));
const itemsOf = new Map(rows.map(row => [row.id, row.items]));

const usage = newUsage();
const started = Date.now();
const results = await mapWithConcurrency(dataset, 3, async (briefing) => {
    const items = itemsOf.get(briefing.id);
    const language = briefing.language;
    const groups = await sameNewsGroups(items, language, {usage, label: briefing.id, log: {log: () => {}, error: console.error}});
    const folded = foldCards(items, groups, {label: briefing.id, log: {log: () => {}, error: console.error}});
    return {id: briefing.id, groups, before: items.length, after: folded.length, folded};
});
const counts = {};
let pairs = 0;
for (const result of results) {
    if (result.status !== 'fulfilled') { console.error('FAILED', result.reason); continue; }
    for (const group of result.value.groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        pairs++;
        const verdict = verdictOf.get(`${result.value.id}:${group[i] + 1}-${group[j] + 1}`) ?? 'NOT JUDGED';
        counts[verdict] = (counts[verdict] ?? 0) + 1;
        if (verdict !== 'SAME') {
            const cards = itemsOf.get(result.value.id);
            console.log(`  ${verdict}: briefing ${result.value.id}: "${(cards[group[i]].titleTranslation ?? cards[group[i]].title).slice(0, 80)}" + "${(cards[group[j]].titleTranslation ?? cards[group[j]].title).slice(0, 80)}"`);
        }
    }
}
const truth = final.filter(one => one.verdict === 'SAME').length;
console.log(`${dataset.length} briefings in ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
console.log(`${pairs} pairs agreed by the two readers: ${JSON.stringify(counts)}; true duplicates found ${counts.SAME ?? 0} of ${truth}`);
const folded = results.filter(result => result.status === 'fulfilled' && result.value.after < result.value.before);
console.log(`${folded.length} briefings lose a card; cards ${results.reduce((sum, result) => sum + (result.value?.before ?? 0), 0)} -> ${results.reduce((sum, result) => sum + (result.value?.after ?? 0), 0)}`);
for (const result of folded.slice(0, 6)) {
    const kept = result.value.folded.find(card => card.joinedCards?.length);
    console.log(`  briefing ${result.value.id}: "${(kept.titleTranslation ?? kept.title).slice(0, 70)}" with ${kept.angles.filter(angle => angle.folded).length} folded angle(s): ${kept.angles.filter(angle => angle.folded).map(angle => (angle.titleTranslation ?? angle.title).slice(0, 50)).join(' | ')}; media ${kept.corroboration?.media}`);
}
await prisma.$disconnect();
process.exit(0);
