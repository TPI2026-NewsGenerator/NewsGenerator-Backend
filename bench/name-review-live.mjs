//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: name-review-live.mjs
//  Description: The review of the names with no item of the server (services/utils/name-review.js) run for real, briefing by briefing, on the
//               saved briefings of the last days: how many names it looks at, what it leaves out (to read), the tokens and the time. Nothing
//               is saved
//
//  node --env-file=.env bench/name-review-live.mjs [briefings]
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {namesToReview, reviewNames} from '../services/utils/name-review.js';

const limit = Number(process.argv[2]) || 30;
const rows = await prisma.$queryRawUnsafe("SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - interval '20 days' AND jsonb_array_length(items) >= 8 ORDER BY id DESC LIMIT $1", limit);
const usage = newUsage();
const started = Date.now();
const results = await mapWithConcurrency(rows, 3, async (row) => ({id: row.id, reviewed: namesToReview(row.items).length,
    flagged: await reviewNames(row.items, {usage, label: row.id, log: {log: () => {}, error: console.error}})}));
let reviewed = 0, flagged = 0;
const byWhy = {};
for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    reviewed += result.value.reviewed;
    flagged += result.value.flagged.size;
    for (const [name, why] of result.value.flagged) (byWhy[why] ??= []).push(name);
}
console.log(`${rows.length} briefings, ${reviewed} names with no item reviewed, ${flagged} left out, ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)} (${Math.round(usage.input / rows.length)} in, ${Math.round(usage.output / rows.length)} out a briefing)`);
for (const [why, names] of Object.entries(byWhy)) console.log(`\n${why} [${names.length}]: ${[...new Set(names)].join(' | ')}`);
await prisma.$disconnect();
process.exit(0);
