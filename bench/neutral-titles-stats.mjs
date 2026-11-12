//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: neutral-titles-stats.mjs
//  Description: What the briefings already written say about the neutral titles: of the cards of the last briefings, how many have the
//               title rewritten by the AI (shown by default), how many only a proposal the checks refused (left to the editor, with what
//               they found), how many neither. Reads, writes nothing
//
//  node bench/neutral-titles-stats.mjs [days = 7]
//

import 'dotenv/config';
import {prisma} from '../config/db.js';

const days = Number(process.argv[2] ?? 7);
const rows = await prisma.$queryRawUnsafe(
    `SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(days));

let cards = 0;
let rewritten = 0;
let proposed = 0;
let shortened = 0;
const problems = new Map();
const examples = [];
for (const row of rows) {
    for (const item of row.items ?? []) {
        cards++;
        if (item.titleRewritten) rewritten++;
        else if (item.titleProposal?.title) {
            proposed++;
            const problem = item.titleProposal.problem ?? 'none';
            problems.set(problem, (problems.get(problem) ?? 0) + 1);
            if (examples.length < 12) examples.push(`  [${problem}] "${item.title}" -> "${item.titleProposal.title}"`);
        } else if (item.titleAsPublished) shortened++;
    }
}
console.log(`${rows.length} briefings of the last ${days} days, ${cards} cards`);
console.log(`title rewritten by the AI, shown by default: ${rewritten}`);
console.log(`rewrite refused by the checks, left to the editor: ${proposed}`);
for (const [problem, count] of [...problems].sort((a, b) => b[1] - a[1])) console.log(`    ${problem}: ${count}`);
console.log(`title only shortened by the code: ${shortened}`);
console.log(examples.join('\n'));
await prisma.$disconnect();
