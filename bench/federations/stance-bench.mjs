// What the AI reads of the position of an association on a person, measured on the real cases of tests/regression/stance-corpus.json
// (built by build-stance-corpus.mjs, labels chosen by hand with their reason): the position it comes to against the label, what kind of
// mistake (a position invented, one missed, the other side, declared for probable), how plainly each part is read (who speaks, how plainly,
// official or hearsay), whether three passes agree, and against a keyword that finds the association and a word of support or opposition.
// The "hard" cases, which a reader could label otherwise, are measured apart. services/utils/stance.js is what is measured.
//
// node --env-file=.env bench/federations/stance-bench.mjs [--model=gemma4:31b] [--repeat=3] [--only=id,id] [--no-save]
import process from 'node:process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {readStance} from '../../services/utils/stance.js';
import {newUsage} from '../../services/utils/ollama.js';

const flags = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=')));
const MODEL = flags.model ?? 'gemma4:31b';
const REPEAT = Number(flags.repeat ?? 3);
const only = flags.only ? new Set(flags.only.split(',')) : null;
const corpus = JSON.parse(readFileSync(new URL('../../tests/regression/stance-corpus.json', import.meta.url), 'utf8'));
const cases = [...corpus.live, ...corpus.hard].filter(item => !only || only.has(item.id.replace('live-stance-', '')) || only.has(item.id));

// The keyword: the association (its name or initials) in the title or the passage, and a word of support or opposition. What the first
// measure of the 30 days counted (measure2.mjs): only a way to count, here to see what the AI adds
const plain = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`´]/g, "'");
const names = (text, key) => new RegExp(`(?<![\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(plain(text));
const SUPPORT = /\b(support\w*|back(?:s|ed|ing)?\b|endors\w*|behind|re-?elect\w*|soutien\w*|soutenir|appui\w*|reelec\w*|apoy\w*|respald\w*|sostegno|sostien\w*|appogg\w*|rielez\w*|unterstutz\w*|wiederwahl|steun\w*|apoi\w*)/u;
const OPPOSE = /\b(oppos\w*|against|critic\w*|reject\w*|resign\w*|step(?:s|ped)? down|challeng\w*|rival\w*|contre|demission\w*|dimiss\w*|rechaz\w*|dimit\w*|ablehn\w*|kritik\w*|rucktritt|boycott\w*|stoccata|refuse\w*|denounc\w*|denunci\w*|attack)/u;
const keyword = (item) => {
    const text = `${item.input.article.title} ${item.input.article.passage}`;
    const keys = [item.input.association.name, ...item.input.association.aliases].map(plain);
    if (!keys.some(key => names(text, key))) return {signal: false};
    const small = plain(text);
    const sup = SUPPORT.test(small), opp = OPPOSE.test(small);
    return {signal: sup || opp, side: sup && opp ? 'both' : sup ? 'for' : opp ? 'against' : null};
};

const sideOf = (position) => position === null ? null : position.startsWith('non_') ? 'against' : 'for';
const degreeOf = (position) => position === null ? null : position.endsWith('declare') ? 'declared' : 'probable';
// what a run got wrong, in one word
const mistake = (expected, got) => {
    if (got === expected) return null;
    if (expected === null) return 'invented';
    if (got === null) return 'missed';
    if (sideOf(got) !== sideOf(expected)) return 'wrong side';
    return 'wrong degree';
};

const usage = newUsage();
const runs = cases.flatMap(item => Array.from({length: REPEAT}, (_, pass) => ({item, pass})));
const answers = new Map();
const started = Date.now();
// four at a time: Ollama takes six, and the others of the key (the app) must still be answered
let next = 0;
await Promise.all(Array.from({length: 4}, async () => {
    while (next < runs.length) {
        const {item, pass} = runs[next++];
        const at = Date.now();
        try {
            // no fallback: a model the plan refuses must fail here, not be answered by gemma4:31b without saying so
            const {reading, decision} = await readStance(item.input, usage, {model: MODEL, fallback: null});
            answers.set(`${item.id}#${pass}`, {reading, decision, ms: Date.now() - at});
        } catch (error) {
            answers.set(`${item.id}#${pass}`, {error: error.message, decision: {signal: false, position: null, why: 'error'}, ms: Date.now() - at});
        }
    }
}));

const rows = cases.map(item => {
    const passes = Array.from({length: REPEAT}, (_, pass) => answers.get(`${item.id}#${pass}`));
    const positions = passes.map(answer => answer.decision.position);
    const expected = item.expect.position;
    return {item, passes, positions, expected, hard: item.hard === true,
        agree: new Set(positions).size === 1, right: positions.filter(position => position === expected).length, keyword: keyword(item)};
});

const share = (a, b) => b === 0 ? 'n/a' : `${a}/${b} (${Math.round(100 * a / b)}%)`;
const scorecard = (selected, label) => {
    const runsOf = selected.flatMap(row => row.passes.map((answer, i) => ({row, answer, got: row.positions[i]})));
    const positives = runsOf.filter(run => run.row.expected !== null), negatives = runsOf.filter(run => run.row.expected === null);
    const errors = {};
    for (const run of runsOf) {
        const kind = mistake(run.row.expected, run.got);
        if (kind) errors[kind] = (errors[kind] ?? 0) + 1;
    }
    const found = positives.filter(run => run.got !== null);
    const fields = (name, test) => {
        const asked = positives.filter(run => run.answer.reading && test.has(run.row.item.expect));
        return share(asked.filter(run => test.ok(run.answer.reading, run.row.item.expect)).length, asked.length);
    };
    console.log(`\n=== ${label}: ${selected.length} cases x ${REPEAT} passes`);
    console.log(`position exactly right:      ${share(runsOf.filter(run => run.got === run.row.expected).length, runsOf.length)}`);
    console.log(`positions found (of those expected): ${share(found.length, positives.length)}   side right when found: ${share(found.filter(run => sideOf(run.got) === sideOf(run.row.expected)).length, found.length)}   degree right when side right: ${share(found.filter(run => sideOf(run.got) === sideOf(run.row.expected) && degreeOf(run.got) === degreeOf(run.row.expected)).length, found.filter(run => sideOf(run.got) === sideOf(run.row.expected)).length)}`);
    console.log(`position invented where none is expected: ${share(negatives.filter(run => run.got !== null).length, negatives.length)}`);
    console.log(`mistakes: ${JSON.stringify(errors)}`);
    console.log(`read plainly (positives, where the label settles it) - stance: ${fields('stance', {has: e => e.stance, ok: (r, e) => r.stance === e.stance})}, who speaks: ${fields('kind', {has: e => e.speaker_kind, ok: (r, e) => r.speakerKind === e.speaker_kind})}, binds: ${fields('binds', {has: e => e.speaker_kind, ok: (r, e) => ['president', 'executive', 'statement'].includes(r.speakerKind) === ['president', 'executive', 'statement'].includes(e.speaker_kind)})}, plainly: ${fields('explicit', {has: e => e.explicit !== undefined, ok: (r, e) => r.explicit === e.explicit})}, official or hearsay: ${fields('mark', {has: e => e.mark, ok: (r, e) => r.mark === e.mark})}`);
    const unreadable = runsOf.filter(run => run.answer.decision.why === 'unreadable' || run.answer.error).length;
    const noQuote = runsOf.filter(run => run.answer.decision.why === 'quote_not_found').length;
    console.log(`not an answer that holds: ${unreadable}, words quoted not in the text: ${noQuote}; same position in all ${REPEAT} passes: ${share(selected.filter(row => row.agree).length, selected.length)}`);
    // the keyword on the same cases, one pass: a signal found or not, and its side
    const k = selected.map(row => ({expected: row.expected, ...row.keyword}));
    const tp = k.filter(x => x.expected !== null && x.signal), fp = k.filter(x => x.expected === null && x.signal), fn = k.filter(x => x.expected !== null && !x.signal);
    console.log(`keyword (association + word of support or opposition): found ${share(tp.length, tp.length + fn.length)}, invented ${share(fp.length, k.filter(x => x.expected === null).length)}, side right when found ${share(tp.filter(x => x.side === sideOf(x.expected)).length, tp.length)}, never says declared or probable`);
};
scorecard(rows.filter(row => !row.hard), 'THE GATE (cases a reader labels the same way)');
scorecard(rows.filter(row => row.hard), 'THE HARD CASES (a reader could label otherwise)');
scorecard(rows, 'ALL');

console.log('\n--- case by case (expected -> position of each pass; * = not the label)');
for (const row of rows) {
    const marks = row.positions.map(position => `${position ?? 'none'}${position === row.expected ? '' : '*'}`);
    const first = row.passes[0];
    console.log(`${row.hard ? 'H' : ' '} ${row.item.id.replace('live-stance-', '').padEnd(40)} ${String(row.expected ?? 'none').padEnd(22)} -> ${marks.join(' | ')}`);
    if (row.right < REPEAT) {
        const why = first.error ? `error ${first.error}` : `${first.decision.why ?? 'signal'}: ${first.reading ? `about=${first.reading.about} kind=${first.reading.speakerKind} stance=${first.reading.stance} toward=${first.reading.toward} explicit=${first.reading.explicit} mark=${first.reading.mark} speaker="${first.reading.speaker}" quote="${first.reading.quote.slice(0, 90)}"` : ''}`;
        console.log(`    ${why}`);
    }
}
const seconds = (Date.now() - started) / 1e3;
console.log(`\n${runs.length} calls of ${MODEL} in ${seconds.toFixed(0)} s (${(answers.size ? [...answers.values()].reduce((sum, answer) => sum + answer.ms, 0) / answers.size / 1e3 : 0).toFixed(1)} s a call), tokens ${JSON.stringify(usage)}`);

if (!('no-save' in flags) && !only) {
    const dir = new URL('./data/', import.meta.url);
    mkdirSync(dir, {recursive: true});
    const file = `stance-${MODEL.replace(/[^a-z0-9.]+/gi, '-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(new URL(file, dir), JSON.stringify({at: new Date().toISOString(), model: MODEL, repeat: REPEAT, usage, rows: rows.map(row => ({id: row.item.id, hard: row.hard, expected: row.expected, positions: row.positions, passes: row.passes.map(answer => ({reading: answer.reading ?? null, decision: answer.decision, error: answer.error ?? null})), keyword: row.keyword}))}, null, 1));
    console.log(`saved: bench/federations/data/${file}`);
}
