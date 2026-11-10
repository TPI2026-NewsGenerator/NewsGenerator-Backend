// The second opinion of the neutral titles, strict (what is built) against loose (the MAIN fact), on the rewrites of bench/neutral-gate.mjs that passed the
// checks of the code, against the ratings made by hand before (<out>-labels.json: ok, mild, bad): what each would keep. Thinking on, 6 pairs a call
//   node --env-file=.env bench/neutral-loose.mjs bench/data/neutral-gate-1110.json [runs=1]
import fs from 'node:fs';
import process from 'node:process';
import {sameFact} from '../services/utils/neutral-titles.js';
import {newUsage} from '../services/utils/ollama.js';

const [file, runs = 1] = [process.argv[2], Number(process.argv[3] ?? 1)];
const result = JSON.parse(fs.readFileSync(file, 'utf8'));
const {labels} = JSON.parse(fs.readFileSync(file.replace(/\.json$/, '-labels.json'), 'utf8'));
const proposed = result.results.filter(entry => entry.status === 'proposed');
const pairs = proposed.map(entry => ({title: entry.title, proposal: entry.proposal}));
const usage = newUsage();
const kept = {strict: proposed.map(entry => entry.same_on?.same === true), loose: proposed.map(() => 0)};
for (let run = 0; run < runs; run++) {
    for (let i = 0; i < pairs.length; i += 6) {
        for (const [at, verdict] of await sameFact(pairs.slice(i, i + 6), usage, {think: true, timeoutMs: 300e3, loose: true})) if (verdict.same) kept.loose[i + at]++;
    }
}
const looseKept = kept.loose.map(count => count * 2 > runs);
const tally = (flags) => ['ok', 'mild', 'bad'].map(label => `${label} ${proposed.filter((_, i) => flags[i] && labels[i + 1] === label).length}`).join(', ');
console.log(`rated: ${tally(proposed.map(() => true))}`);
console.log(`strict keeps ${kept.strict.filter(Boolean).length}: ${tally(kept.strict)}`);
console.log(`loose keeps ${looseKept.filter(Boolean).length}: ${tally(looseKept)} (runs ${runs}), tokens ${JSON.stringify(usage)}`);
proposed.forEach((entry, i) => { if (looseKept[i] !== kept.strict[i]) console.log(`  #${i + 1} ${labels[i + 1]}: strict ${kept.strict[i]}, loose ${looseKept[i]} | ${entry.title.slice(0, 70)} -> ${entry.proposal.slice(0, 70)}`); });
