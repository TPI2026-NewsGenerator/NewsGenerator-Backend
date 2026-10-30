// The picks of mGENRE (scores-<mode>.json) against the judged cases of bench/context: the candidate of the best
// log-probability ("sum", or "mean" per token), none when it is under a floor or not ahead of the second by a
// margin. right / country / wrong / other / lost as in bench/context/score.mjs, with the AI of that bench
// (ai.json) and fp32 against int8. node bench/mgenre/score.mjs
import fs from 'node:fs';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const cases = read('../context/cases.json');
const requests = read('./requests.json');
const outcome = (c, pick) => {
    if (!pick) return c.right.length > 0 ? 'lost' : 'right';
    if (c.right.includes(pick)) return 'right';
    if (c.country.includes(pick)) return 'country';
    if (c.wrong.includes(pick)) return 'wrong';
    return c.right.length > 0 ? 'other' : 'wrong';
};
const modes = ['fp32', 'int8'].filter(mode => fs.existsSync(new URL(`./scores-${mode}.json`, import.meta.url)));
const scores = Object.fromEntries(modes.map(mode => [mode, new Map(read(`./scores-${mode}.json`).map(r => [r.id, r]))]));

// undefined when the name was not ranked
const pick = (mode, index, {by, floor, margin}) => {
    const r = scores[mode].get(String(index));
    if (!r) return undefined;
    const values = r.sum.map((s, i) => by === 'mean' ? s / r.length[i] : s);
    const [best, second] = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    if (best[0] < floor) return null;
    if (second && best[0] - second[0] < margin) return null;
    return requests[index].qids[best[1]];
};
const tally = (mode, params, suite) => {
    const t = {right: 0, country: 0, wrong: 0, other: 0, lost: 0};
    cases.forEach((c, i) => {
        if (suite !== 'all' && c.suite !== suite) return;
        const p = pick(mode, i, params);
        if (p !== undefined) t[outcome(c, p)]++;
    });
    return `${t.right}/${t.country}/${t.wrong}/${t.other}/${t.lost}`;
};
console.log('right/country/wrong/other/lost');
const ai = read('../context/ai.json');
for (const suite of ['judged', 'extras', 'all']) {
    const t = {};
    ai.filter(a => suite === 'all' || a.suite === suite).forEach(a => { t[a.result] = (t[a.result] ?? 0) + 1; });
    console.log(`AI of bench/context   ${suite.padEnd(7)} ${t.right ?? 0}/${t.country ?? 0}/${t.wrong ?? 0}/${t.other ?? 0}/${t.lost ?? 0}`);
}
for (const mode of modes) {
    for (const by of ['sum', 'mean']) {
        const floors = by === 'mean' ? [-Infinity, -2, -1.5, -1] : [-Infinity, -12, -8, -5];
        for (const floor of floors) {
            for (const margin of [0, 1, 2]) {
                const params = {by, floor, margin};
                console.log(`${mode} ${by} floor ${String(floor).padStart(9)} margin ${margin}  judged ${tally(mode, params, 'judged').padEnd(14)} extras ${tally(mode, params, 'extras').padEnd(12)} all ${tally(mode, params, 'all')}`);
            }
        }
    }
}
if (modes.length === 2) {
    let same = 0;
    let total = 0;
    cases.forEach((c, i) => {
        const a = pick('fp32', i, {by: 'sum', floor: -Infinity, margin: 0});
        const b = pick('int8', i, {by: 'sum', floor: -Infinity, margin: 0});
        if (a !== undefined && b !== undefined) {
            total++;
            if (a === b) same++;
        }
    });
    console.log(`\nfp32 and int8 pick the same candidate in ${same} of ${total} cases`);
}
for (const mode of modes) {
    const ms = [...scores[mode].values()].map(r => r.ms).sort((a, b) => a - b);
    console.log(`${mode}: median ${ms[Math.floor(ms.length / 2)]} ms a name, 95th ${ms[Math.floor(ms.length * 0.95)]} ms, ${ms.length} names`);
}
