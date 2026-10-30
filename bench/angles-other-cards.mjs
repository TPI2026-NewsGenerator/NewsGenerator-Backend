// Read only: the angles judged on a briefing (bench/angles-places.mjs DATA file + its labels) and their
// likeness to the stories of the OTHER cards of the briefing: does it tell the angles repeating another
// card (label C) from the right ones (G)?   DATA=./data/angles-enzo98.json LABELS=... node --env-file=.env bench/angles-other-cards.mjs
import fs from 'node:fs';
import process from 'node:process';
import {StoryModel} from '../models/story-model.js';
import {prisma} from '../config/db.js';

const briefings = JSON.parse(fs.readFileSync(new URL(process.env.DATA, import.meta.url), 'utf8'));
const labels = JSON.parse(fs.readFileSync(new URL(process.env.LABELS, import.meta.url), 'utf8'));
for (const briefing of briefings) {
    const cardIds = briefing.cards.map(card => card.id);
    const shown = new Set(briefing.runs.flatMap(run => Object.entries(run).flatMap(([card, ids]) => ids.map(id => `${card}:${id}`))));
    const angleIds = [...new Set([...shown].map(key => Number(key.split(':')[1])))];
    const rows = await StoryModel.likenessAmong([...new Set([...cardIds, ...angleIds])]);
    const like = new Map(rows.map(row => [`${row.a}:${row.b}`, row.likeness]));
    const of = (a, b) => like.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0;
    const out = [];
    for (const key of shown) {
        const [card, angle] = key.split(':').map(Number);
        const others = cardIds.filter(id => id !== card).map(id => [id, of(angle, id)]).sort((x, y) => y[1] - x[1]);
        out.push({label: labels[key] ?? '?', own: of(angle, card).toFixed(2), other: others[0][1].toFixed(2), otherCard: others[0][0], key});
    }
    out.sort((x, y) => y.other - x.other);
    console.table(out.slice(0, 30));
}
await prisma.$disconnect();
