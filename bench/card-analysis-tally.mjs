// The analysis runs against the code checks (checked-*.json) and the blind verdicts
// (judge/lines-verdicts-*.json, hand corrections in judge/lines-overrides.json
// {"<card>|<file>|<line>": {"support": "...", "useful": "..."}}):
//   node bench/card-analysis-tally.mjs  -> data/card-analysis/tally.json
// support: SUPPORTED, MISCITED (true by another source of the card), CERTAINTY (certainty or attribution
// slip), UNSUPPORTED (a fact, link or cause no source gives), OUTSIDE (outside knowledge)
// useful: USEFUL (helps understand beyond the card), SOME, NO (repeats the card, or padding)
import fs from 'node:fs';
import {nextText} from './card-analysis-prompt.mjs';

const DIR = new URL('./data/card-analysis/', import.meta.url);
// JUDGE_DIR=judge-v2: the verdicts of round 2, only the runs its packets hold -> tally-v2.json
const JUDGE = new URL(`${process.env.JUDGE_DIR ?? 'judge'}/`, DIR);
const key = JSON.parse(fs.readFileSync(new URL('key.json', JUDGE), 'utf8'));
const BAD = new Set(['UNSUPPORTED', 'OUTSIDE', 'CERTAINTY']);

const verdicts = {}, worth = {};
for (const f of fs.readdirSync(JUDGE).filter(f => /^lines-verdicts-\d+\.json$/.test(f))) {
    const v = JSON.parse(fs.readFileSync(new URL(f, JUDGE), 'utf8'));
    for (const l of v.lines ?? []) {
        const file = key[l.card]?.[l.version];
        if (file) verdicts[`${l.card}|${file}|${l.line}`] = l;
    }
    for (const w of v.versions ?? []) {
        const file = key[w.card]?.[w.version];
        if (file) worth[`${w.card}|${file}`] = w.worth;
    }
}
const OVERRIDES = new URL('lines-overrides.json', JUDGE);
const overrides = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};
for (const [k, o] of Object.entries(overrides)) {
    if (k.split('|').length === 3) verdicts[k] = {...verdicts[k], ...o};
    else if (o.worth) worth[k] = o.worth;
}

const list = (items) => Array.isArray(items) ? items : [];
const out = {};
const flagged = [];
const judgedFiles = new Set(Object.values(key).flatMap(v => Object.values(v)));
for (const file of fs.readdirSync(DIR).filter(f => /^analysis-.*\.json$/.test(f) && !f.includes('.try') && judgedFiles.has(f))) {
    const {summary, results} = JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8'));
    const checked = JSON.parse(fs.readFileSync(new URL(file.replace(/^analysis-/, 'checked-'), DIR), 'utf8'));
    const t = out[file] = {cards: results.length, failed: results.filter(r => r.error).length, empty: 0, lines: 0, why: 0, next: 0,
        dropped: 0, droppedRightly: 0, judged: 0, kept: {lines: 0, bad: 0, miscited: 0, useful: 0, some: 0, no: 0, badNext: 0, next: 0},
        worth: {yes: 0, no: 0}, badByKind: {}, usd: summary.usage.usd, usdPerCard: summary.usdPerCall, secondsPerCard: summary.secondsPerCall,
        maxSeconds: summary.maxSeconds, tokensPerCard: summary.tokensPerCall};
    for (const r of results.filter(r => !r.error)) {
        const card = `${r.briefing}-${r.card}`;
        const lines = [...list(r.json.why).map(l => ({part: 'why', text: String(l?.text ?? '')})),
            ...list(r.json.next).map(l => ({part: 'next', text: nextText(l)}))];
        if (lines.length === 0) t.empty++;
        const w = worth[`${card}|${file}`];
        if (w === 'YES') t.worth.yes++; else if (w === 'NO') t.worth.no++;
        lines.forEach((line, j) => {
            t.lines++;
            t[line.part]++;
            const check = checked.find(c => c.briefing === r.briefing && c.card === r.card && c.raw === line.text);
            const v = verdicts[`${card}|${file}|${j + 1}`];
            if (v) t.judged++;
            if (check && !check.kept) {
                t.dropped++;
                if (v && BAD.has(v.support)) t.droppedRightly++;
                return;
            }
            t.kept.lines++;
            if (line.part === 'next') t.kept.next++;
            if (!v) return;
            if (BAD.has(v.support)) {
                t.kept.bad++;
                if (line.part === 'next') t.kept.badNext++;
                t.badByKind[v.support] = (t.badByKind[v.support] ?? 0) + 1;
                flagged.push({file, card, line: j + 1, part: line.part, support: v.support, useful: v.useful, note: v.note, text: line.text});
            }
            if (v.support === 'MISCITED') t.kept.miscited++;
            if (v.useful === 'USEFUL') t.kept.useful++; else if (v.useful === 'SOME') t.kept.some++; else if (v.useful === 'NO') t.kept.no++;
        });
    }
    // the reader's view: cards whose shown analysis (lines kept after the checks) holds a bad line
    t.cardsWithBad = new Set(flagged.filter(f => f.file === file).map(f => f.card)).size;
    t.badWhy = t.kept.bad - t.kept.badNext;
    t.badPerCard = +(t.kept.bad / (t.cards - t.failed)).toFixed(2);
    t.badShare = +(t.kept.bad / t.kept.lines).toFixed(3);
    t.usefulShare = +(t.kept.useful / t.kept.lines).toFixed(3);
}
// thinking ON run 1 on the cards of run 2 only, to compare the two runs on the same cards
const run2 = 'analysis-deepseek-v4-pro-0813-on-2.json';
if (out[run2] && out['analysis-deepseek-v4-pro-0813-on-1.json']) {
    const cards = new Set(JSON.parse(fs.readFileSync(new URL(run2, DIR), 'utf8')).results.map(r => `${r.briefing}-${r.card}`));
    const same = (file) => {
        const bad = flagged.filter(f => f.file === file && cards.has(f.card));
        const kept = JSON.parse(fs.readFileSync(new URL(file.replace(/^analysis-/, 'checked-'), DIR), 'utf8'))
            .filter(l => l.kept && cards.has(`${l.briefing}-${l.card}`)).length;
        const w = Object.entries(worth).filter(([k, v]) => k.endsWith(`|${file}`) && cards.has(k.split('|')[0]) && v === 'YES').length;
        return {kept, bad: bad.length, cardsWithBad: new Set(bad.map(f => f.card)).size, worthYes: w};
    };
    out.sameCards = {cards: cards.size, run1: same('analysis-deepseek-v4-pro-0813-on-1.json'), run2: same(run2)};
}
fs.writeFileSync(new URL(process.env.JUDGE_DIR ? `tally-${process.env.JUDGE_DIR.replace(/^judge-?/, '')}.json` : 'tally.json', DIR), JSON.stringify({runs: out, flagged}, null, 1));
for (const [f, t] of Object.entries(out)) console.log(f, JSON.stringify(t));
console.log(`${flagged.length} flagged lines kept after checks (see tally.json)`);
