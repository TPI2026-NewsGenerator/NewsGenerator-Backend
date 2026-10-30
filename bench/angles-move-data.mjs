// Read only on the DB: a DATA file of bench/angles-places.mjs with the other cards some candidates of
// each card are closer to (nearCardsOf, named to the AI), runs emptied, for REJUDGE=1.
//   node --env-file=.env bench/angles-move-data.mjs in.json out.json
import fs from 'node:fs';
import process from 'node:process';
import {StoryModel} from '../models/story-model.js';
import {nearCardsOf} from '../services/utils/other-angles.js';
import {prisma} from '../config/db.js';

const [from, to] = process.argv.slice(2).map(file => new URL(file, import.meta.url));
const briefings = JSON.parse(fs.readFileSync(from, 'utf8'));
for (const briefing of briefings) {
    const ids = [...new Set(briefing.cards.flatMap(card => card.others.map(other => other.storyId)))];
    const like = new Map((await StoryModel.likenessTo(ids, briefing.cards.map(card => card.id))).map(row => [`${row.a}:${row.b}`, row.likeness]));
    const near = nearCardsOf(briefing.cards, (story, card) => like.get(`${story}:${card}`) ?? 0);
    const titleOf = new Map(briefing.cards.map(card => [card.id, card.title]));
    briefing.cards = briefing.cards.map(card => ({...card, otherCards: near.get(card.id).map(id => titleOf.get(id))}));
    console.log(`briefing ${briefing.id}: ${briefing.cards.filter(card => card.otherCards.length > 0).length} cards with other cards named`);
    briefing.runs = [];
}
fs.writeFileSync(to, JSON.stringify(briefings, null, 1));
await prisma.$disconnect();
