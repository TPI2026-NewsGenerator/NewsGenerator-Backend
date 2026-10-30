// Read only: the versions in other languages of the cards of a saved briefing (as acrossOf asks them,
// ACROSS_LIKENESS 0.78) up to 'cap', and where the angle stories labeled S (same fact as their card) or
// C (the fact of another card) of bench/data/angles-enzo98-labels.json stand among them: a fact told in
// many languages leaves its 5th+ versions out of its card (ACROSS_PER_STORY 4), and they come back as
// angles.   node --env-file=.env bench/across-cap.mjs [briefing=98] [cap=12]
import process from 'node:process';
import fs from 'node:fs';
import {StoryModel} from '../models/story-model.js';
import {feedsOf} from '../services/briefing-service.js';
import {prisma} from '../config/db.js';

const [id, cap] = [Number(process.argv[2] ?? 98), Number(process.argv[3] ?? 12)];
const labels = JSON.parse(fs.readFileSync(new URL('./data/angles-enzo98-labels.json', import.meta.url), 'utf8'));
const [b] = await prisma.$queryRawUnsafe('SELECT id_profile, hours, created_at, items FROM briefings WHERE id = $1', id);
const feedUrls = await feedsOf(b.id_profile);
const since = new Date(b.created_at.getTime() - b.hours * 3600e3);
const cards = b.items.filter(item => item.storyId > 0);
const rows = await StoryModel.versionsAcross({storyIds: cards.map(c => c.storyId), language: 'en', feedUrls, since, likeness: 0.78, perStory: cap});
const marked = Object.entries(labels).filter(([, l]) => l === 'S' || l === 'C').map(([k, l]) => [Number(k.split(':')[1]), `${l} of ${k.split(':')[0]}`]);
const mark = new Map(marked);
let perCard = [];
for (const card of cards) {
    const versions = rows.filter(r => r.id_story === card.storyId);
    const joined = new Set(card.mergedStoryIds ?? []);
    perCard.push(versions.length);
    if (versions.length === 0) continue;
    console.log(`\n${card.storyId} ${card.title.slice(0, 70)}  (${versions.length} versions >= 0.78)`);
    versions.forEach((v, i) => console.log(`  ${i + 1}. ${v.id_version} ${v.likeness.toFixed(2)}${joined.has(v.id_version) ? ' JOINED' : ''}${mark.has(v.id_version) ? `  <- angle ${mark.get(v.id_version)}` : ''}`));
}
console.log(`\nversions per card: ${JSON.stringify(perCard)}`);
await prisma.$disconnect();
