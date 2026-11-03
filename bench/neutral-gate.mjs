// The neutral title in three steps, measured on the titles of the cards of the briefings of the last days (the user, 03.11.2026:
// "que l'IA évalue s'il est nécessaire de changer avant de changer"): the AI says which titles have a judgment, an emphasis or a
// call to click (judgedTitles); only those are rewritten (rewrittenTitle, thinking on, the checks of the code); the pairs that pass
// are given to the AI once more to say whether the rewrite tells exactly the same fact (sameFact). Everything is written to a file
// to be read by hand: the titles judged, every rewrite with the verdict of the second opinion, and the titles not judged that
// look like they have bait (to count what the first step misses).
//   node --env-file=.env bench/neutral-gate.mjs <out.json> [days=14] [max=300] [batch=40]
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import {judgedTitles, rewrittenTitle, sameFact} from '../services/utils/neutral-titles.js';
import {newUsage} from '../services/utils/ollama.js';
import {writtenIn} from '../services/utils/language.js';

const [out, days = 14, max = 300, batch = 40] = [process.argv[2], ...process.argv.slice(3).map(Number)];
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT items FROM briefings WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, [days]);
await client.end();
const cards = [...new Map(rows.flatMap(row => row.items).filter(item => item.title && item.summary).map(item => [item.title, item])).values()]
    .sort((a, b) => a.title < b.title ? -1 : 1);
const step = Math.max(1, Math.floor(cards.length / max));
const sample = cards.filter((_, i) => i % step === 0).slice(0, max);
const shown = (item) => item.titleTranslation ?? item.title;
const text = (item) => [].concat(item.translation?.length ? item.translation : item.summary).join(' ');
console.log(`${cards.length} cards, ${sample.length} in the sample`);

const usage = {judging: newUsage(), rewriting: newUsage(), checking: newUsage(), checkingThinking: newUsage()};
// steps 1 and 2 are kept in a file next to the result: a run that fails later starts again from there
const kept = `${out}.state.json`;
let judged;
let results;
if (fs.existsSync(kept)) {
    ({judged, results} = JSON.parse(fs.readFileSync(kept, 'utf8')));
    judged = new Map(judged);
    console.log(`steps 1 and 2 read from ${kept}: ${judged.size} judged, ${results.length} rewritten`);
} else {
    // 1. which titles have a judgment
    judged = new Map();
    let started = Date.now();
    for (let i = 0; i < sample.length; i += batch) {
        const part = sample.slice(i, i + batch);
        for (const [at, words] of await judgedTitles(part.map(shown), usage.judging)) judged.set(i + at, words);
    }
    console.log(`judged: ${judged.size} of ${sample.length} titles have bait (${((Date.now() - started) / 1000).toFixed(0)} s), tokens ${JSON.stringify(usage.judging)}`);

    // 2. the rewrite of the ones judged
    results = [];
    started = Date.now();
    for (const [at, words] of judged) {
        const item = sample[at];
        const entry = {at, title: shown(item), words, status: null, proposal: null, problem: null};
        try {
            const answer = await rewrittenTitle(entry.title, text(item), usage.rewriting, {language: item.titleTranslation ? null : writtenIn(item.language)});
            entry.status = answer.title ? 'proposed' : answer.reason;
            entry.proposal = answer.title ?? answer.proposal ?? null;
            entry.problem = answer.problem ?? null;
        } catch (err) {
            entry.status = 'failed';
            entry.problem = err.message;
        }
        results.push(entry);
        console.log(`  rewritten ${results.length}/${judged.size}: ${entry.status}`);
    }
    console.log(`rewritten in ${((Date.now() - started) / 1000).toFixed(0)} s, tokens ${JSON.stringify(usage.rewriting)}`);
    fs.writeFileSync(kept, JSON.stringify({judged: [...judged], results}, null, 1));
}

// 3. the second opinion on the proposals that passed the checks, with thinking off and on, a few pairs at a time (a long
// batch with thinking did not answer in 120 s)
const proposed = results.filter(entry => entry.status === 'proposed');
const pairs = proposed.map(entry => ({title: entry.title, proposal: entry.proposal}));
for (const [name, think] of [['off', false], ['on', true]]) {
    const verdicts = new Map();
    for (let i = 0; i < pairs.length; i += 6) {
        try {
            for (const [at, verdict] of await sameFact(pairs.slice(i, i + 6), usage[think ? 'checkingThinking' : 'checking'], {think, timeoutMs: 300e3})) verdicts.set(i + at, verdict);
        } catch (err) {
            console.log(`  the second opinion (thinking ${name}) of pairs ${i + 1} to ${i + 6} failed: ${err.message}`);
        }
    }
    proposed.forEach((entry, i) => { entry[`same_${name}`] = verdicts.get(i) ?? null; });
    console.log(`  second opinion, thinking ${name}: ${verdicts.size} of ${pairs.length} pairs answered`);
}
console.log(`checked: tokens off ${JSON.stringify(usage.checking)}, on ${JSON.stringify(usage.checkingThinking)}`);

// the titles not judged that look like they have bait, to count the misses of the first step
const BAIT = /!|\b(incroyable|choc|bombe|scandale|honteu|historique|énorme|révélation|urgent|incredible|unbelievable|shocking|stunning|bombshell|devastating|massive|huge|disgrace|shameful|slams|destroys|humiliates|furious|outrage|nightmare|sensational|escándalo|increíble|bomba|scandalo|vergogna|incredibile|skandal|unglaublich|schock|sensacional|escândalo|inacreditável)/iu;
const missed = sample.map((item, at) => ({at, title: shown(item)})).filter(({at, title}) => !judged.has(at) && BAIT.test(title));
const notJudged = sample.map((item, at) => ({at, title: shown(item)})).filter(({at}) => !judged.has(at));
fs.writeFileSync(out, JSON.stringify({sample: sample.length, judged: judged.size, results, missed, notJudged, usage}, null, 1));
console.log(`done: ${results.length} rewritten, ${proposed.length} proposed, ${missed.length} not judged with a mark of bait, written to ${out}`);
