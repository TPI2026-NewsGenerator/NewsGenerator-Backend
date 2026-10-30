// The rules keeping or dropping the one item called so of a person, scored against truth.json (true: the
// item is the person the news name, false: another one or no person, "?" unsure): for each sample (the most
// met, at random, at random in 0 Wikipedias, named: Eduardo Varela and family names after a particle), right: kept and right, wrong: kept and wrong, lost: dropped
// and right. node bench/lone-items/score.mjs
import fs from 'node:fs';
import {familyName} from '../../services/utils/person-items.js';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const truth = read('./truth.json');
const results = read('./results.json');
const named = read('./results-named.json');
const zero = read('./results-zero.json');
const samples = {most: results.filter(e => e.most), random: results.filter(e => !e.most), zero,
    named: named.filter(e => !zero.some(z => z.name === e.name))};

const contradicts = (e) => Boolean(e.country && e.mediaCountry && e.country !== e.mediaCountry);
const rules = {
    'now (any item)': () => true,
    'human': (e) => e.human,
};
for (const least of [1, 2, 3, 5, 10]) rules[`human, ${least}+ wikis`] = (e) => e.human && e.links >= least;
Object.assign(rules, {
    'human, 1+ wikis or media country': (e) => e.human && (e.links >= 1 || (e.country && e.country === e.mediaCountry)),
    'human, not of another country': (e) => e.human && !contradicts(e),
    'human, 1+ wikis, not of another country': (e) => e.human && e.links >= 1 && !contradicts(e),
    'human, AI not no': (e) => e.human && e.ai !== 'no',
    'human, AI yes': (e) => e.human && e.ai === 'yes',
    'human, 1+ wikis or AI yes': (e) => e.human && (e.links >= 1 || e.ai === 'yes'),
    'human, 1+ wikis or AI yes, not byline 0': (e) => e.human && (e.links >= 1 || (e.ai === 'yes' && !e.byline)),
    'human, 1+ wikis, AI not no': (e) => e.human && e.links >= 1 && e.ai !== 'no',
    // built (person-items.js): a family name after a particle is no full name
    'BUILT human, 1+ wikis not family, else AI yes': (e) => e.human && ((e.links >= 1 && !familyName(e.name)) || e.ai === 'yes'),
});

for (const [sample, entries] of Object.entries(samples)) {
    const judged = entries.filter(e => typeof truth[e.name] === 'boolean');
    console.log(`\n${sample}: ${judged.length} judged, ${judged.filter(e => truth[e.name]).length} right items, ${judged.filter(e => !truth[e.name]).length} wrong`);
    for (const [name, keep] of Object.entries(rules)) {
        const kept = judged.filter(keep);
        const wrong = kept.filter(e => !truth[e.name]);
        const lost = judged.filter(e => truth[e.name] && !keep(e));
        console.log(`  ${name.padEnd(42)} right ${String(kept.length - wrong.length).padStart(2)}  wrong ${String(wrong.length).padStart(2)}  lost ${String(lost.length).padStart(2)}`
            + `  ${wrong.length ? 'W: ' + wrong.map(e => e.name).join(', ') : ''}${lost.length ? '  L: ' + lost.map(e => e.name).join(', ') : ''}`);
    }
}
