// Read only: the stories bench/other-angles.mjs found for each card judged by the AI from their titles,
// compared with the labels by hand (other-angles-labels.json). One call per card. Written to
// bench/data/other-angles-ai.txt
//   node --env-file=.env bench/other-angles-ai.mjs
import fs from 'node:fs';
import {newUsage, ollamaJson} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {anglesPrompt} from '../services/utils/other-angles.js';
import {prisma} from '../config/db.js';

const text = fs.readFileSync(new URL('./data/other-angles.txt', import.meta.url), 'utf8');
const labels = JSON.parse(fs.readFileSync(new URL('./data/other-angles-labels.json', import.meta.url), 'utf8'));
const cards = [];
for (const line of text.split('\n')) {
    const head = line.match(/^#(\d+) \[p(\d+) (\w+)[^\]]*\] (.*)$/);
    if (head) { cards.push({id: head[1], profile: head[2], title: head[4], others: []}); continue; }
    const row = line.match(/^ {2}([AB]) ([\d.]+) (\w+) \d+m #\d+ (.*)$/);
    if (row) { const card = cards.at(-1); card.others.push({likeness: Number(row[2]), title: row[4], label: labels[card.profile][card.id][card.others.length]}); }
}

// the prompt of the briefing (services/utils/other-angles.js)
// the other titles of each card's articles, as the briefing gives them (cardTitles)
const items = new Map((await prisma.$queryRawUnsafe(`SELECT item FROM briefings b, jsonb_array_elements(b.items) item
    WHERE b.id_profile IN (7, 8) AND b.status = 'ready' AND b.created_at > now() - interval '5 days'`)).map(row => [String(row.item.storyId), row.item]));
const cardTitles = (card) => {
    const others = (items.get(card.id)?.articles ?? []).filter(article => article.title && article.title !== card.title);
    const perLanguage = [...new Map(others.map(article => [article.language, article])).values()];
    return [...new Set([...perLanguage, ...others].map(article => article.title))].slice(0, 5);
};
// STANCE=1: with the sentence on the stances of an actor (13.10.2026, the Latvian federation)
const STANCE = `another party's view, an earlier or later stance of one of its actors on the same election, vote or
  dispute, even weeks apart (a body backing one side, then the other).`;
const prompt = (card) => {
    const text = anglesPrompt(card.title, card.others, cardTitles(card));
    return process.env.STANCE === '1' ? text.replace("another party's view.", STANCE) : text;
};

const usage = newUsage();
const results = await mapWithConcurrency(cards.filter(card => card.others.length), 3, async (card) => {
    const answer = await ollamaJson(prompt(card), usage);
    const kinds = new Map((answer?.news ?? []).map(item => [Number(item.n), item.kind]));
    return {...card, others: card.others.map((other, i) => ({...other, ai: kinds.get(i + 1) ?? 'none'}))};
});
const done = results.filter(r => r.status === 'fulfilled').map(r => r.value);
const lines = [];
for (const p of ['7', '8']) {
    const rows = done.filter(card => card.profile === p).flatMap(card => card.others.map(other => ({...other, card: card.id})));
    const shown = rows.filter(row => row.ai === 'angle');
    const by = (list) => Object.fromEntries(['G', 'S', 'T', 'W'].map(k => [k, list.filter(r => r.label === k).length]));
    const g = rows.filter(row => row.label === 'G');
    lines.push(`profile ${p}: ${rows.length} judged, AI "angle" ${shown.length} ${JSON.stringify(by(shown))}, precision ${(100 * by(shown).G / (shown.length || 1)).toFixed(0)}%, `
        + `recall ${shown.filter(r => r.label === 'G').length}/${g.length}, cards with a right angle ${new Set(shown.filter(r => r.label === 'G').map(r => r.card)).size} of ${new Set(rows.map(r => r.card)).size}`);
    lines.push(`  AI "same" ${JSON.stringify(by(rows.filter(r => r.ai === 'same')))}, "theme" ${JSON.stringify(by(rows.filter(r => r.ai === 'theme')))}, "other" ${JSON.stringify(by(rows.filter(r => r.ai === 'other')))}`);
}
lines.push(`failed ${results.length - done.length}, tokens ${JSON.stringify(usage)}`, '');
for (const card of done) {
    lines.push(`#${card.id} p${card.profile} ${card.title}`);
    for (const other of card.others) lines.push(`  ${other.label} ai:${other.ai.padEnd(6)} ${other.likeness} ${other.title}`);
}
fs.writeFileSync(new URL('./data/other-angles-ai.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.slice(0, 5).join('\n'));
process.exit(0);
