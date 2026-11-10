// The titles the judge of the neutral titles said had no bait, rewritten all the same (what the editor's button does for any title), to see what the judge leaves:
// how many the rewrite changes and what it changes them to, to be rated by hand (friend of the user, 10.11.2026: "il y en a que 6% qui sont réécrites")
//   node --env-file=.env bench/neutral-unjudged.mjs bench/data/neutral-gate-1110.json [n=60]
import fs from 'node:fs';
import process from 'node:process';
import {rewrittenTitle} from '../services/utils/neutral-titles.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {newUsage} from '../services/utils/ollama.js';

const [file, n = 60] = [process.argv[2], Number(process.argv[3] ?? 60)];
const {notJudged} = JSON.parse(fs.readFileSync(file, 'utf8'));
// every Nth: the same sample from one run to the next
const step = Math.max(1, Math.floor(notJudged.length / n));
const sample = notJudged.filter((_, i) => i % step === 0).slice(0, n);
const usage = newUsage();
const out = await mapWithConcurrency(sample, 4, async ({title}) => {
    try {
        const answer = await rewrittenTitle(title, '', usage, {timeoutMs: 90e3});
        return {title, status: answer.title ? 'proposed' : answer.reason, proposal: answer.title ?? answer.proposal ?? null, problem: answer.problem ?? null};
    } catch (err) {
        return {title, status: 'failed', proposal: null, problem: err.message};
    }
});
const results = out.map(item => item.value);
fs.writeFileSync(file.replace(/\.json$/, '-unjudged.json'), JSON.stringify(results, null, 1));
const by = {};
for (const item of results) by[item.status] = (by[item.status] ?? 0) + 1;
console.log(`${results.length} titles not judged: ${JSON.stringify(by)}, tokens ${JSON.stringify(usage)}`);
results.filter(item => item.status === 'proposed').forEach((item, i) => console.log(`#${i + 1}\nA: ${item.title}\nB: ${item.proposal}\n`));
