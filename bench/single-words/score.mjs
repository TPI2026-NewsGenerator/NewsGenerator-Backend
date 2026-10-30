// The rules keeping or dropping a person of one word linked to a human, scored against truth.json (judged by
// hand on the titles of their news, 21.10.2026: R the item is the person, W another, ? unsure, in the order of
// sample.json): kept right, kept wrong, lost (a right one dropped), removed (a wrong one dropped).
// node bench/single-words/score.mjs
import fs from 'node:fs';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const sample = read('./sample.json');
const truth = read('./truth.json').join('');
const judged = sample.map((e, i) => ({...e, truth: truth[i]})).filter(e => e.truth !== '?');
const same = (e) => e.label.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '') === e.name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const rules = {'now (any human)': () => true};
for (const least of [5, 10, 15, 20, 25, 30, 40, 50, 60]) rules[`${least}+ Wikipedias`] = (e) => e.links >= least;
rules['label is the name, or 30+'] = (e) => same(e) || e.links >= 30;
rules['label is the name, or 40+'] = (e) => same(e) || e.links >= 40;
for (const [title, set] of [['all', judged], ['most seen 80', judged.filter(e => e.top)], ['random 100', judged.filter(e => !e.top)]]) {
    console.log(`\n${title}: ${set.length} judged, ${set.filter(e => e.truth === 'R').length} right, ${set.filter(e => e.truth === 'W').length} wrong`);
    console.table(Object.fromEntries(Object.entries(rules).map(([name, keep]) => [name, {
        'kept right': set.filter(e => e.truth === 'R' && keep(e)).length,
        'kept wrong': set.filter(e => e.truth === 'W' && keep(e)).length,
        'lost': set.filter(e => e.truth === 'R' && !keep(e)).length,
        'removed': set.filter(e => e.truth === 'W' && !keep(e)).length,
    }])));
}
