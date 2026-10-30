// Strategies telling the item of a name from its context, scored against the cases (cases.json, features.json):
// right (the item judged right, or none where none is right), country (a wrong item of the right country),
// wrong (judged wrong), other (an item nobody judged where one is right), lost (none where one is right).
// node bench/context/score.mjs [grid]
import fs from 'node:fs';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const cases = read('./cases.json');
const features = new Map(read('./features.json').map(f => [f.id + f.name + f.lang, f]));
const lone = read('../lone-organizations/results.json');

const outcome = (c, pick) => {
    if (!pick) return c.right.length > 0 ? 'lost' : 'right';
    if (c.right.includes(pick)) return 'right';
    if (c.country.includes(pick)) return 'country';
    if (c.wrong.includes(pick)) return 'wrong';
    return c.right.length > 0 ? 'other' : 'wrong';
};
const sim = (f) => {
    const top = [...f.sims].sort((a, b) => b - a).slice(0, 3);
    return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
};
const share = (c, country) => {
    // the share of the sites with a country that are of this one
    const code = (site) => { const d = site.split('.').at(-1); return d === 'uk' ? 'GB' : /^[a-z]{2}$/.test(d) ? d.toUpperCase() : null; };
    const by = {};
    for (const row of c.sites) { const k = code(row.site); if (k) by[k] = (by[k] ?? 0) + row.news; }
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    return total >= 5 && country ? (by[country] ?? 0) / total : null;
};
// the rule of organization-items.js now, from what the lone-organizations bench kept
const BODY = ['P159', 'P118', 'P641', 'P452', 'P112', 'P1454', 'P749', 'P488', 'P169', 'P1128', 'P414', 'P127', 'P355'];
const baseline = (c) => {
    if (c.suite !== 'judged') return undefined;
    const r = lone.find(x => x.id === c.id);
    if (!r.lone) return r.ai?.qid ?? null;
    const has = (p) => r.props.includes(p);
    const place = !has('P297') && (has('P1082') || (has('P625') && !BODY.some(has)) || r.p31.includes('Q486972'));
    const kept = !r.p31.includes('Q5') && !place && !has('P577') && r.links >= 2;
    return kept ? r.qid : (r.ai?.qid && true ? r.ai.qid : null);
};
const strategies = {
    'current rule (lone kept, else the AI)': (c) => baseline(c),
};
export const contextPick = (c, f, {floor, margin, prior = 0, country = 0}) => {
    const scored = c.candidates.map((item, i) => {
        const feat = f.candidates[i];
        const own = share(c, feat.country);
        const s = sim(feat) + prior * Math.log(1 + (item.links ?? 0)) / Math.log(301)
            + (country && own !== null && !feat.international ? country * (own - 0.2) : 0);
        return {qid: item.qid, s, base: sim(feat)};
    }).sort((a, b) => b.s - a.s);
    const [first, second] = scored;
    if (!first || first.base < floor) return null;
    return first.s - (second?.s ?? -1) >= margin ? first.qid : null;
};
const run = (pickOf, set) => {
    const tally = {right: 0, country: 0, wrong: 0, other: 0, lost: 0};
    for (const c of set) { const p = pickOf(c); if (p !== undefined) tally[outcome(c, p)]++; }
    return tally;
};
const sets = {judged: cases.filter(c => c.suite === 'judged'), extras: cases.filter(c => c.suite === 'extras'), all: cases};
const show = (name, pickOf) => {
    const row = {};
    for (const [label, set] of Object.entries(sets)) { const t = run(pickOf, set); row[label] = `${t.right}/${t.country}/${t.wrong}/${t.other}/${t.lost}`; }
    console.log(name.padEnd(54), Object.entries(row).map(([k, v]) => `${k} ${v}`).join('   '));
};
console.log('right/country/wrong/other/lost');
show('current rule (judged only)', (c) => baseline(c));
const grid = [];
for (const floor of [0.3, 0.4, 0.5]) for (const margin of [0, 0.03, 0.06, 0.1]) for (const prior of [0, 0.05, 0.1]) for (const country of [0, 0.15, 0.3]) grid.push({floor, margin, prior, country});
const results = grid.map(p => {
    const t = run(c => contextPick(c, features.get(c.id + c.name + c.lang), p), cases);
    return {p, t, score: t.right * 1 + t.country * 0.3 - t.wrong * 3 - t.other * 3 - t.lost * 1};
}).sort((a, b) => b.score - a.score);
for (const {p, t} of results.slice(0, 8)) show(`context ${JSON.stringify(p)}`, c => contextPick(c, features.get(c.id + c.name + c.lang), p));
if (process.argv[2] === 'grid') for (const {p, t} of results) console.log(JSON.stringify(p), JSON.stringify(t));
export {cases, features, outcome, sim, share, baseline};
