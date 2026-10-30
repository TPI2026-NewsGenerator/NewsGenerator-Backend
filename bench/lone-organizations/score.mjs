// The rules keeping or refusing the one item called so of an organisation, scored against truth.json
// ({name: {qid: true | "country" | false | "?"}}: the item linked and the one the AI chose instead, judged by
// hand; "country" a wrong item of the same country, as the city of a club). A refused item goes to the AI
// as several would (the choice bench.mjs read, kept in MIN_SITELINKS Wikipedias, or in `least` for the
// variants). For each sample (most met, at random, suspect: a human, a place, a work, in 0-2 Wikipedias):
// right, the item at the end the one the news name; country, a wrong item of the right country; wrong,
// another; none; lost, the item linked right but not kept. node bench/lone-organizations/score.mjs
import fs from 'node:fs';
import {MIN_SITELINKS} from '../../services/utils/organization-items.js';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url)));
const truth = read('./truth.json');
const judged = read('./results.json').filter(e => e.lone && [true, false, 'country'].includes(truth[e.name]?.[e.qid]));
const samples = {'most + random': judged.filter(e => e.sample !== 'suspect'), suspect: judged.filter(e => e.sample === 'suspect'), all: judged};

const has = (e, property) => e.props.includes(property);
const human = (e) => e.p31.includes('Q5');
// a place people live in: a population (P1082), no country code (P297): a country named as a body is
// the country (the national team, the government: its country is right)
const settlement = (e) => has(e, 'P1082') && !has(e, 'P297');
const work = (e) => has(e, 'P577');
const ORGANISATION = ['P159', 'P118', 'P641', 'P452', 'P112', 'P1454', 'P749', 'P488', 'P169', 'P1128', 'P414', 'P127', 'P355'];
const organisation = (e) => ORGANISATION.some(property => has(e, property));

// a place: a settlement, or a position on Earth (P625) and nothing of a body (a seat, a league, a sport...)
const place = (e) => !has(e, 'P297') && (settlement(e) || (has(e, 'P625') && !organisation(e)));
// variants: located in an administrative entity (P131) as a position; the class human settlement (Q486972)
const placeP131 = (e) => !has(e, 'P297') && (settlement(e) || ((has(e, 'P625') || has(e, 'P131')) && !organisation(e)));
const placeQ486972 = (e) => place(e) || e.p31.includes('Q486972');
const rules = {
    'now (any item)': [() => true],
    'AI for all': [() => false],
    'AI for all, AI item in 1+': [() => false, 1],
    'no human': [(e) => !human(e)],
    'no P625': [(e) => !has(e, 'P625')],
    'no settlement': [(e) => !settlement(e)],
    'no work': [(e) => !work(e)],
    'no human, settlement, work': [(e) => !human(e) && !settlement(e) && !work(e)],
    'no human, settlement, work, AI item in 1+': [(e) => !human(e) && !settlement(e) && !work(e), 1],
    'organisation property': [organisation],
};
for (const least of [1, 2, 3, 5, 10]) rules[`${least}+ wikis`] = [(e) => e.links >= least];
for (const least of [1, 2, 3]) rules[`no human, settlement, work, ${least}+ wikis`] = [(e) => !human(e) && !settlement(e) && !work(e) && e.links >= least];
rules['no human, settlement, work, 1+ wikis, AI item in 1+'] = [(e) => !human(e) && !settlement(e) && !work(e) && e.links >= 1, 1];
rules['no human, place, work, 1+ wikis'] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= 1];
rules['no human, place, work, 1+ wikis, AI item in 1+'] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= 1, 1];
rules['no human, place, work, 1+ wikis, AI item in 2+'] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= 1, 2];
rules['no human, place, work, 1+ wikis, AI item in 5+'] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= 1, 5];
rules['no human, place, work, 3+ wikis, AI item in 1+'] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= 3, 1];
for (const [least, ai] of [[2, 1], [3, 2], [3, 10], [3, 0], [5, 1]]) rules[`no human, place, work, ${least}+ wikis, AI item in ${ai}+`] = [(e) => !human(e) && !place(e) && !work(e) && e.links >= least, ai];
rules['no human, place P131, work, 2+ wikis, AI item in 1+'] = [(e) => !human(e) && !placeP131(e) && !work(e) && e.links >= 2, 1];
rules['no human, place Q486972, work, 2+ wikis, AI item in 1+'] = [(e) => !human(e) && !placeQ486972(e) && !work(e) && e.links >= 2, 1];
// built (organization-items.js, wikidata.js isPlace): a bare human settlement is a place too ("Al-Hazm", no
// sample item changed)
rules['BUILT no human, place, work, 2+ wikis, AI item in 1+'] = [(e) => !human(e) && !placeQ486972(e) && !work(e) && e.links >= 2, 1];
rules['no place, work, 1+ wikis, AI item in 1+'] = [(e) => !place(e) && !work(e) && e.links >= 1, 1];

const finalOf = (e, keep, least) => keep(e) ? e.qid : (e.ai && e.ai.links >= least ? e.ai.qid : null);
const verdict = (e, qid) => qid === null ? 'none' : truth[e.name][qid] === true ? 'right' : truth[e.name][qid] === 'country' ? 'country' : truth[e.name][qid] === false ? 'wrong' : 'unjudged';
for (const [sample, entries] of Object.entries(samples)) {
    const count = (value) => entries.filter(e => truth[e.name][e.qid] === value).length;
    console.log(`\n${sample}: ${entries.length} judged, items right ${count(true)}, country only ${count('country')}, wrong ${count(false)}`);
    for (const [name, [keep, least = MIN_SITELINKS]] of Object.entries(rules)) {
        const counts = {right: [], country: [], wrong: [], none: [], unjudged: []};
        for (const e of entries) counts[verdict(e, finalOf(e, keep, least))].push(e.name);
        const lost = entries.filter(e => truth[e.name][e.qid] === true && verdict(e, finalOf(e, keep, least)) !== 'right').map(e => e.name);
        console.log(`  ${name.padEnd(52)} right ${String(counts.right.length).padStart(3)}  country ${String(counts.country.length).padStart(2)}  wrong ${String(counts.wrong.length).padStart(2)}  none ${String(counts.none.length).padStart(2)}  lost ${String(lost.length).padStart(2)}`
            + (counts.unjudged.length ? `  UNJUDGED ${counts.unjudged.join(', ')}` : '')
            + (sample === 'all' ? `${counts.wrong.length ? '  W: ' + counts.wrong.join(', ') : ''}${lost.length ? '  L: ' + lost.join(', ') : ''}` : ''));
    }
}
