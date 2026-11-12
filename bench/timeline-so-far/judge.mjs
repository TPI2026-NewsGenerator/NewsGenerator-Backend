//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: judge.mjs
//  Description: What the AI step of "the story so far" (services/utils/timeline-relevance.js) keeps and takes out, on the cards of the
//               briefings of the last days: every card with the lines of its thread, the kept ones marked "+", the taken out "-", to be
//               read by hand. Writes bench/data/timeline-so-far/judged.json (the cards and their lines, to be labelled) and costs one call
//               a card
//
//  node bench/timeline-so-far/judge.mjs [days = 5] [first card = 0] [cards = 100]
//

import 'dotenv/config';
import {mkdirSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {relatedLines} from '../../services/utils/timeline-relevance.js';
import {mapWithConcurrency} from '../../services/utils/concurrency.js';
import {newUsage} from '../../services/utils/ollama.js';

const [days = 5, first = 0, count = 100] = process.argv.slice(2).map(Number);
const briefings = await prisma.$queryRawUnsafe(
    `SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(days));
const cards = new Map();
for (const row of briefings) for (const item of row.items ?? []) if (item.summary && !cards.has(item.storyId)) cards.set(item.storyId, item);

const lines = await prisma.$queryRawUnsafe(`
    SELECT s.id AS card, o.id, o.created_at, first.title, first.medium
    FROM stories s
    JOIN stories o ON o.id_thread = s.id_thread AND o.id <> s.id AND o.created_at < s.created_at
    CROSS JOIN LATERAL (SELECT a.title, a.medium FROM articles a WHERE a.id_story = o.id ORDER BY COALESCE(a.published_at, a.created_at) LIMIT 1) AS first
    WHERE s.id = ANY($1::int[]) AND s.id_thread IS NOT NULL
    ORDER BY o.created_at DESC`, [...cards.keys()]);
const byCard = new Map();
for (const line of lines) {
    if (!byCard.has(line.card)) byCard.set(line.card, []);
    const seen = byCard.get(line.card);
    const title = line.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.some(one => one.key === title)) seen.push({key: title, date: line.created_at.toISOString().slice(0, 10), title: line.title, medium: line.medium});
}

const picked = [...byCard.keys()].slice(first, first + count);
const usage = newUsage();
const judged = await mapWithConcurrency(picked, 3, async (storyId) => {
    const item = cards.get(storyId);
    const all = byCard.get(storyId).slice(0, 24);
    const kept = await relatedLines({title: item.titleTranslation ?? item.title, summary: item.summary}, all, usage);
    return {storyId, title: item.titleTranslation ?? item.title, lines: all.map(line => ({date: line.date, title: line.title, kept: kept.includes(line)}))};
});
const done = judged.filter(result => result.status === 'fulfilled').map(result => result.value);
let total = 0, keptLines = 0;
for (const card of done) {
    console.log(`\n"${card.title.slice(0, 90)}" (${card.storyId})`);
    for (const line of card.lines) {
        total++;
        if (line.kept) keptLines++;
        console.log(`  ${line.kept ? '+' : '-'} ${line.date} ${line.title.slice(0, 100)}`);
    }
}
console.log(`\n${done.length} cards, ${total} lines, ${keptLines} kept, ${total - keptLines} taken out; ${usage.calls} calls, ${usage.input} tokens in, ${usage.output} out`);
mkdirSync(new URL('../data/timeline-so-far/', import.meta.url), {recursive: true});
writeFileSync(new URL('../data/timeline-so-far/judged.json', import.meta.url), JSON.stringify(done, null, 1));
await prisma.$disconnect();
