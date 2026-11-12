//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: add-cases.mjs
//  Description: Adds to the corpus of regression the live family "timelinerelated" (the lines of "the story so far" kept by the AI of
//               services/utils/timeline-relevance.js) from the cards of the briefings of the last days: a card of the FKF of Kenya whose
//               thread held the NFF of Nigeria (none kept), and two cards whose lines are of their own affair (all kept)
//
//  node --env-file=.env bench/timeline-so-far/add-cases.mjs
//

import {readFileSync, writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';

const file = new URL('../../tests/regression/corpus.json', import.meta.url);
const judged = JSON.parse(readFileSync(new URL('../data/timeline-so-far/judged-v2.json', import.meta.url), 'utf8'));
const wanted = [
    {storyId: 2514000, key: 'kenya-card-nigeria-lines', why: 'a card of the FKF of Kenya whose thread held the normalisation committee of the NFF of Nigeria: six lines of another country, none is of its affair', kept: 'none'},
    {storyId: 2563005, key: 'fkf-expulsion', why: 'the expulsion of the members of the committee of the FKF: the six lines are of its own affair', kept: 'all'},
    {storyId: 2464342, key: 'fifa-documents', why: 'the FIFA files on the World Cup sale plan: the five lines (four languages) are of its own affair', kept: 'all'},
];

const rows = await prisma.$queryRawUnsafe('SELECT items FROM briefings WHERE status = \'ready\' AND created_at > now() - interval \'7 days\' ORDER BY id DESC');
const items = new Map();
for (const row of rows) for (const item of row.items ?? []) if (!items.has(item.storyId)) items.set(item.storyId, item);

const cases = wanted.map(({storyId, key, why, kept}) => {
    const card = judged.find(one => one.storyId === storyId);
    const item = items.get(storyId);
    if (!card || !item) throw new Error(`card ${storyId} not found`);
    const lines = card.lines.map(line => ({date: line.date, title: line.title}));
    return {id: `live-timelinerelated-${key}`, family: 'timelinerelated',
        origin: `a friend of the user, 12.11.2026 (the card "The story so far" with Nigeria on a card of Kenya), bench/timeline-so-far: ${why}`,
        input: {title: item.titleTranslation ?? item.title, summary: String(item.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), lines},
        expect: {kept: kept === 'all' ? lines.map((line, i) => i) : []}};
});

let text = readFileSync(file, 'utf8');
if (text.includes('"id":"live-timelinerelated-kenya-card-nigeria-lines"')) throw new Error('these cases are already in the corpus');
if (!text.trimEnd().endsWith(']\n}')) throw new Error('the end of the live cases was not found');
const at = text.lastIndexOf('\n    ]');
text = `${text.slice(0, at)},\n${cases.map(item => `        ${JSON.stringify(item)}`).join(',\n')}${text.slice(at)}`;
writeFileSync(file, text);
console.log(`${cases.length} live cases added`);
await prisma.$disconnect();
