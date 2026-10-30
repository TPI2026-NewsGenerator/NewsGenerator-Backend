// Read only: the angles judged in a bench/angles-places.mjs DATA file, shown as anglesOf does ("5, one
// place by names") with and without a rule that leaves a candidate to the OTHER card it is closer to
// (an angle of card X closer to card Y: the fact of Y told in another language, or an angle of Y).
// Counted with the hand labels (C = the fact of another card).
//   DATA=./data/angles-enzo98-base.json LABELS=./data/angles-enzo98-labels.json node --env-file=.env bench/angles-cross-rule.mjs
import fs from 'node:fs';
import process from 'node:process';
import {StoryModel} from '../models/story-model.js';
import {placeAngles} from '../services/utils/other-angles.js';
import {prisma} from '../config/db.js';

const briefings = JSON.parse(fs.readFileSync(new URL(process.env.DATA, import.meta.url), 'utf8'));
const labels = JSON.parse(fs.readFileSync(new URL(process.env.LABELS, import.meta.url), 'utf8'));
const RULES = {
    none: () => true,
    'closer to another card': (own, other) => other <= own,
    'closer, other >= 0.78': (own, other) => other <= own || other < 0.78,
    'closer by 0.03': (own, other) => other < own + 0.03,
    'closer, other >= 0.85': (own, other) => other <= own || other < 0.85,
    'closer, other >= 0.88': (own, other) => other <= own || other < 0.88,
    'closer, other >= 0.90': (own, other) => other <= own || other < 0.90,
};
for (const briefing of briefings) {
    const cardIds = briefing.cards.map(card => card.id);
    const candidateIds = [...new Set(briefing.cards.flatMap(card => card.others.map(other => other.storyId)))];
    const rows = await StoryModel.likenessAmong([...new Set([...cardIds, ...candidateIds])]);
    const like = new Map(rows.map(row => [`${row.a}:${row.b}`, row.likeness]));
    const of = (a, b) => like.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0;
    for (const [name, keep] of Object.entries(RULES)) {
        const line = [];
        for (const run of briefing.runs) {
            const counts = {};
            let withG = 0;
            const placed = new Set();
            for (const card of briefing.cards) {
                const others = cardIds.filter(id => id !== card.id);
                const judged = (run[card.id] ?? []).map(id => card.others.find(other => other.storyId === id))
                    .filter(other => !placed.has(other.storyId))
                    .filter(other => keep(of(other.storyId, card.id), Math.max(0, ...others.map(id => of(other.storyId, id)))));
                const shown = placeAngles(judged, 5);
                shown.forEach(other => placed.add(other.storyId));
                const kinds = shown.map(other => labels[`${card.id}:${other.storyId}`] ?? '?');
                kinds.forEach(kind => counts[kind] = (counts[kind] ?? 0) + 1);
                if (kinds.includes('G')) withG++;
            }
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            line.push(`${total} shown ${JSON.stringify(counts)} right ${(100 * (counts.G ?? 0) / (total || 1)).toFixed(0)}%, cards with a right one ${withG}/${briefing.cards.length}`);
        }
        console.log(`briefing ${briefing.id} ${name}\n  ${line.join('\n  ')}`);
    }
}
await prisma.$disconnect();
