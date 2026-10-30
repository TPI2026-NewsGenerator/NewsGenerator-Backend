// The AI of bench/context (ai.json) and mGENRE (scores-<mode>.json) together on the judged cases: where the AI says
// none, mGENRE's pick when it is sure enough (floor on the log-probability, margin to the second); how often the two
// agree. right / country / wrong / other / lost as in score.mjs. node bench/mgenre/combine.mjs [fp32|int8]
import fs from 'node:fs';

const mode = process.argv[2] ?? 'fp32';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const cases = read('../context/cases.json');
const requests = read('./requests.json');
const ai = read('../context/ai.json');
const scores = new Map(read(`./scores-${mode}.json`).map(r => [r.id, r]));
const outcome = (c, pick) => {
    if (!pick) return c.right.length > 0 ? 'lost' : 'right';
    if (c.right.includes(pick)) return 'right';
    if (c.country.includes(pick)) return 'country';
    if (c.wrong.includes(pick)) return 'wrong';
    return c.right.length > 0 ? 'other' : 'wrong';
};
const top = (i, floor, margin) => {
    const r = scores.get(String(i));
    if (!r) return null;
    const [best, second] = r.sum.map((s, k) => [s, k]).sort((a, b) => b[0] - a[0]);
    if (best[0] < floor || (second && best[0] - second[0] < margin)) return null;
    return requests[i].qids[best[1]];
};
const tally = (pickOf) => {
    const t = {right: 0, country: 0, wrong: 0, other: 0, lost: 0};
    cases.forEach((c, i) => { t[outcome(c, pickOf(i))]++; });
    return `${t.right}/${t.country}/${t.wrong}/${t.other}/${t.lost}`;
};
const agree = {both: 0, aiOnly: 0, mgenreOnly: 0, neither: 0};
const aiLost = [];
cases.forEach((c, i) => {
    const a = outcome(c, ai[i].pick) === 'right';
    const m = outcome(c, top(i, -Infinity, 0)) === 'right';
    agree[a && m ? 'both' : a ? 'aiOnly' : m ? 'mgenreOnly' : 'neither']++;
    if (c.right.length > 0 && !ai[i].pick) aiLost.push({name: c.name, lang: c.lang, mgenre: outcome(c, top(i, -Infinity, 0)), right: c.right.join('/')});
});
console.log(`right with the AI and mGENRE: both ${agree.both}, AI only ${agree.aiOnly}, mGENRE only ${agree.mgenreOnly}, neither ${agree.neither}`);
console.log(`the AI says none where one is right (${aiLost.length}): mGENRE right on ${aiLost.filter(l => l.mgenre === 'right').length}`);
console.log('\nright/country/wrong/other/lost');
console.log(`AI alone                          ${tally(i => ai[i].pick)}`);
for (const [floor, margin] of [[-Infinity, 0], [-12, 0], [-8, 0], [-5, 0], [-12, 2], [-8, 2], [-5, 2]]) {
    console.log(`AI, else mGENRE floor ${String(floor).padStart(9)} margin ${margin}  ${tally(i => ai[i].pick ?? top(i, floor, margin))}`);
}
// the AI's pick kept only when mGENRE does not rank another candidate far ahead of it
for (const gap of [2, 4, 6]) {
    console.log(`AI, none when mGENRE ranks another ${gap} ahead  ${tally(i => {
        const r = scores.get(String(i));
        if (!ai[i].pick || !r) return ai[i].pick;
        const at = requests[i].qids.indexOf(ai[i].pick);
        return at >= 0 && Math.max(...r.sum) - r.sum[at] > gap ? null : ai[i].pick;
    })}`);
}
console.log('\nthe cases the AI loses:');
for (const l of aiLost) console.log(`${l.mgenre}\t${l.name} [${l.lang}] right ${l.right}`);
