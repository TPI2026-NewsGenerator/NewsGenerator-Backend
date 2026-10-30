// Read only: the other angles shown below a card that tell the same fact as each other (the FIFA's
// denial of a second salary for Infantino in 4 languages below one card, 14.10.2026), on the 47 cards
// of bench/angles-places.mjs (Enzo's three profiles: briefings 90, 91, 92). Duplicates labeled by hand
// in bench/data/angles-dups-labels.json, angles in bench/data/angles-places-labels.json.
//   PAIRS=1 node --env-file=.env bench/angles-dups.mjs   likeness of the candidates of each card two by
//                                                         two (centroids), bench/data/angles-pairs.json
//   JUDGE=1 RUNS=3 node --env-file=.env bench/angles-dups.mjs   the prompt of today asked RUNS times,
//                                                         its answers in bench/data/angles-dups-answers.json
//   node bench/angles-dups.mjs                            counts each rule on the same answers
import fs from 'node:fs';
import {normalizeAngles, placeAngles, sameFactsOut} from '../services/utils/other-angles.js';

const DATA = new URL('./data/angles-places.json', import.meta.url);
const PAIRS = new URL('./data/angles-pairs.json', import.meta.url);
const ANSWERS = new URL('./data/angles-dups-answers.json', import.meta.url);
const read = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
const labels = read(new URL('./data/angles-places-labels.json', import.meta.url));
const dups = read(new URL('./data/angles-dups-labels.json', import.meta.url));
const briefings = read(DATA);

if (process.env.PAIRS === '1') {
    const {StoryModel} = await import('../models/story-model.js');
    const {prisma} = await import('../config/db.js');
    const pairs = {};
    for (const card of briefings.flatMap(briefing => briefing.cards)) {
        for (const row of await StoryModel.likenessAmong(card.others.map(other => other.storyId))) {
            pairs[`${card.id}:${row.a}:${row.b}`] = Number(row.likeness.toFixed(3));
        }
    }
    fs.writeFileSync(PAIRS, JSON.stringify(pairs));
    console.log(`${Object.keys(pairs).length} pairs`);
    await prisma.$disconnect();
    process.exit(0);
}

if (process.env.JUDGE === '1') {
    const {anglesPrompt} = await import('../services/utils/other-angles.js');
    const {ollamaJson, newUsage} = await import('../services/utils/ollama.js');
    const {mapWithConcurrency} = await import('../services/utils/concurrency.js');
    const usage = newUsage();
    const runs = [];
    for (let run = 0; run < Number(process.env.RUNS ?? 2); run++) {
        const answers = {};
        for (const briefing of briefings) {
            const cards = briefing.cards.filter(card => card.others.length > 0);
            const results = await mapWithConcurrency(cards, 5, card =>
                ollamaJson(anglesPrompt(card.title, card.others, card.titles ?? [], card.at), usage));
            cards.forEach((card, i) => { answers[card.id] = results[i].status === 'fulfilled' ? results[i].value : null; });
        }
        runs.push(answers);
        console.log(`run ${run + 1}: ${JSON.stringify(usage)}`);
    }
    fs.writeFileSync(ANSWERS, JSON.stringify(runs));
    process.exit(0);
}

const pairs = read(PAIRS);
const likenessIn = (card) => (a, b) => pairs[`${card}:${Math.min(a, b)}:${Math.max(a, b)}`] ?? 0;
// the fact of a right angle: its group of the labels, or itself
const factOf = (card, id) => {
    const group = (dups[card] ?? []).find(ids => ids.includes(id));
    return group ? `g${group[0]}` : `s${id}`;
};

// each rule: the angles of the AI's answer, in its order -> the ones left before placeAngles
const RULES = {
    'without "as" (before)': (card, angles) => angles,
    '"as" alone': (card, angles) => sameFactsOut(angles, () => 1),
    ...Object.fromEntries([0.80, 0.85, 0.90].map(min => [`"as" and likeness >= ${min}`,
        (card, angles) => sameFactsOut(angles, likenessIn(card), min)])),
};

const runs = read(ANSWERS);
for (const [name, rule] of Object.entries(RULES)) {
    console.log(name);
    for (const answers of runs) {
        const counts = {G: 0, S: 0, T: 0, W: 0, '?': 0};
        let facts = 0, repeated = 0, withG = 0, cards = 0;
        for (const briefing of briefings) {
            const placed = new Set();
            for (const card of briefing.cards) {
                cards++;
                const angles = normalizeAngles(answers[card.id], card.others).filter(other => !placed.has(other.storyId));
                const shown = placeAngles(rule(card.id, angles));
                shown.forEach(other => placed.add(other.storyId));
                const seen = new Set();
                for (const other of shown) {
                    const kind = labels[`${card.id}:${other.storyId}`] ?? '?';
                    counts[kind]++;
                    if (kind !== 'G') continue;
                    const fact = factOf(card.id, other.storyId);
                    if (seen.has(fact)) repeated++; else seen.add(fact);
                }
                facts += seen.size;
                if (seen.size > 0) withG++;
            }
        }
        const shown = Object.values(counts).reduce((a, b) => a + b, 0);
        console.log(`  ${shown} shown, right ${counts.G} = ${facts} facts + ${repeated} repeated, S ${counts.S} T ${counts.T} W ${counts.W}`
            + `${counts['?'] ? ` unlabeled ${counts['?']}` : ''}, cards with a right one ${withG}/${cards}`);
    }
}
