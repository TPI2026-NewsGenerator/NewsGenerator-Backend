// The triage runs against the blind verdicts (judge/triage-verdicts-*.json, hand corrections in
// judge/triage-overrides.json {"<briefing>-<n>": "MERITS|BORDERLINE|PLAIN"}):
//   node bench/card-analysis-triage-tally.mjs  -> data/card-analysis/triage-tally.json
// wrong pick = a PLAIN card picked; miss = a MERITS card not picked; BORDERLINE counts neither way.
import fs from 'node:fs';

const DIR = new URL('./data/card-analysis/', import.meta.url);
const JUDGE = new URL('judge/', DIR);
const briefings = JSON.parse(fs.readFileSync(new URL('cards.json', DIR), 'utf8'));
const verdicts = {};
for (const f of fs.readdirSync(JUDGE).filter(f => /^triage-verdicts-\d+\.json$/.test(f))) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(new URL(f, JUDGE), 'utf8')).cards)) verdicts[k] = v.verdict;
}
const OVERRIDES = new URL('triage-overrides.json', JUDGE);
const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};
Object.assign(verdicts, Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v.verdict ?? v])));
const all = briefings.flatMap(b => b.cards.map(c => ({key: `${b.id}-${c.n}`, history: c.timeline.days > 0})));
const count = (f) => all.filter(f).length;
const out = {verdicts: {MERITS: count(c => verdicts[c.key] === 'MERITS'), BORDERLINE: count(c => verdicts[c.key] === 'BORDERLINE'),
    PLAIN: count(c => verdicts[c.key] === 'PLAIN'), missing: count(c => !verdicts[c.key])},
    meritsWithHistory: count(c => verdicts[c.key] === 'MERITS' && c.history), plainWithHistory: count(c => verdicts[c.key] === 'PLAIN' && c.history), runs: {}};
const picksOf = {};
for (const f of fs.readdirSync(DIR).filter(f => /^triage-.*-\d+\.json$/.test(f))) {
    const {summary, results} = JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8'));
    const picked = new Set(results.flatMap(r => (r.json?.cards ?? []).map(c => `${r.briefing}-${Number(c?.n)}`)));
    picksOf[f] = picked;
    const pickedList = all.filter(c => picked.has(c.key));
    out.runs[f] = {
        picked: pickedList.length,
        merits: pickedList.filter(c => verdicts[c.key] === 'MERITS').length,
        borderline: pickedList.filter(c => verdicts[c.key] === 'BORDERLINE').length,
        wrongPicks: pickedList.filter(c => verdicts[c.key] === 'PLAIN').map(c => c.key),
        misses: all.filter(c => verdicts[c.key] === 'MERITS' && !picked.has(c.key)).map(c => c.key),
        usd: summary.usage.usd, secondsPerCall: summary.secondsPerCall, tokensPerCall: summary.tokensPerCall,
    };
}
// stability: the same model's two runs
for (const model of ['deepseek-v4-pro-0813-off', 'gemma4-31b-none']) {
    const [a, b] = [1, 2].map(r => picksOf[`triage-${model}-${r}.json`]);
    if (a && b) out[`stability ${model}`] = {both: [...a].filter(k => b.has(k)).length, onlyOne: [...a].filter(k => !b.has(k)).length + [...b].filter(k => !a.has(k)).length};
}
fs.writeFileSync(new URL('triage-tally.json', DIR), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => Array.isArray(v) ? `${v.length}: ${v.join(' ')}` : v, 1));
