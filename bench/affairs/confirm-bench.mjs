// The second opinion on the 11 alerts of the replay of the UEFA-Infantino affair (bench/affairs/replay.mjs), read by hand:
// G good (a new fact of the affair), B borderline (related, or already known in other words), W wrong (another matter or
// the same fact told again). Each alert is asked on its own with what was told before it, for each prompt and model
//
//  node bench/affairs/confirm-bench.mjs <replay.json>
import 'dotenv/config';
import process from 'node:process';
import {readFileSync} from 'node:fs';
import {confirmEvents, confirmPrompt, CONFIRM_MODEL} from '../../services/utils/affair-judge.js';
import {newUsage} from '../../services/utils/ollama.js';

const {rings} = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// my reading, in the order of the replay
const LABELS = ['B', 'G', 'B', 'W', 'G', 'B', 'G', 'G', 'G', 'B', 'W'];
const file = {
    title: 'Governance crisis and ethics investigations regarding Gianni Infantino and FIFA',
    about: "A series of ethics complaints, undisclosed income disputes, and UEFA's demands for transparency and its search for a challenger regarding Gianni Infantino's presidency of FIFA.",
    not: "Infantino's other activities, the organisation of the World Cup, the internal disputes of other federations or confederations.",
};

// the prompt as it was before 4.11.2026 evening: the latest facts only, no "same affair" condition
const oldPrompt = (f, known, events) => confirmPrompt(f, known, events)
    .replace(/It must be both:[\s\S]*?In doubt: false\. A notification for nothing is worse than a late one\./, 'only when it brings a NEW FACT that changes where the affair stands: a decision, an announcement, a revelation, a ruling, a resignation, a candidacy, a sanction, a vote, an official denial or reaction that is news in itself, a figure.\nfalse for: a comment, an opinion, an analysis, a preview, a recap, a reaction without news, the same fact as one the reader knows told again or with one more detail, a minor step, news of the same people on another matter.\nIn doubt: false.');

const PATTERN = 'The same kind of fact as ones the reader was already told, happening to one more country, company or person (one more shop hit, one more country affected), is NOT new unless it changes the nature or the scale of the affair (the first country beyond the first ones, the identity of the attackers, an arrest, a claim, an official measure, a financial figure).\n';
const withPattern = (f, known, events) => confirmPrompt(f, known, events).replace('In doubt: false.', `${PATTERN}In doubt: false.`);

const variants = [
    ['new prompt, gemma', {model: 'gemma4:31b'}],
    ['new prompt + pattern clause, gemma', {model: 'gemma4:31b', prompt: withPattern}],
];
for (const [name, options] of variants) {
    const usage = newUsage();
    const rung = [];
    for (let i = 0; i < rings.length; i++) {
        // what the reader knows: the alerts before this one
        const known = rings.slice(0, i);
        const [yes] = await confirmEvents(file, known, [rings[i]], usage, options).catch(err => { console.error(err.message); return [null]; });
        rung.push(yes);
    }
    const count = (label, yes) => rung.filter((one, i) => LABELS[i] === label && one === yes).length;
    console.log(`${name}: rings ${rung.filter(Boolean).length}/${rung.length}  G kept ${count('G', true)}/5  B kept ${count('B', true)}/4  W kept ${count('W', true)}/2   ${rung.map((one, i) => `${LABELS[i]}${one ? '+' : '-'}`).join(' ')}   tokens ${JSON.stringify(usage)}`);
}
