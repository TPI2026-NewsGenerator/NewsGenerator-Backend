// The rules of bench.mjs scored against truth.json (the right item of each name, null for none, "?" unsure)
import fs from 'node:fs';
const results = [...JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url))),
    ...JSON.parse(fs.readFileSync(new URL('./results-named.json', import.meta.url)))];
const sites = JSON.parse(fs.readFileSync(new URL('./sites.json', import.meta.url)));
const truth = {...JSON.parse(fs.readFileSync(new URL('./truth.json', import.meta.url))),
    // the referee of the cards of Enzo, and the byline of a sports site that raised the threshold to 30
    'Istvan Kovacs': 'Q12731153', 'Mohammed Ibrahim': null};
const famous = (humans, min, ahead) => {
    const [first, second] = [...humans].sort((a, b) => b.links - a.links);
    return first && first.links >= min && first.links >= ahead * (second?.links ?? 0) ? first.qid : null;
};
// the country of most of the sites naming it that have one, when it is share of them at least
const mediaCountry = (e, share) => {
    const total = Object.values(e.byCountry ?? {}).reduce((a, b) => a + b, 0);
    const [top] = Object.entries(e.byCountry ?? {}).sort((a, b) => b[1] - a[1]);
    return top && total >= 3 && top[1] >= share * total ? top[0] : null;
};
const rules = {};
for (const min of [30, 20, 10, 5, 0]) for (const ahead of [3, 2]) rules[`famous min${min} x${ahead}`] = (e) => famous(e.humans, min, ahead);
for (const share of [0.5, 0.7]) for (const min of [10, 5, 0]) {
    // famous among all first, else among the ones of the media's country
    rules[`famous30x3 + country${share} min${min}`] = (e) => {
        const all = famous(e.humans, 30, 3);
        if (all) return all;
        const code = mediaCountry(e, share);
        const local = e.humans.filter(h => code && h.country === code);
        return local.length === 1 && local[0].links >= min ? local[0].qid : famous(local, Math.max(min, 1), 3);
    };
}
// a name most of its news of one site write is a byline as often: the threshold of 30 kept for it
for (const min of [10, 5]) for (const guard of [0.8, 0.9]) for (const country of [false, true]) {
    rules[`min${min} x3 byline${guard}${country ? ' + country' : ''}`] = (e) => {
        const least = (sites[e.name]?.share ?? 0) >= guard ? 30 : min;
        const all = famous(e.humans, least, 3);
        if (all || !country) return all;
        const code = mediaCountry(e, 0.5);
        const local = e.humans.filter(h => code && h.country === code);
        return local.length === 1 && local[0].links >= least ? local[0].qid : famous(local, least, 3);
    };
}
const judged = results.filter(e => e.humans?.length && e.name in truth && truth[e.name] !== '?');
console.log(`${judged.length} names judged (${judged.filter(e => truth[e.name]).length} with a right item)`);
for (const [name, rule] of Object.entries(rules)) {
    let right = 0, wrong = 0, missed = 0;
    const errors = [];
    for (const e of judged) {
        const got = rule(e), want = truth[e.name];
        if (got && got === want) right++;
        else if (got) { wrong++; errors.push(`${e.name}->${got}`); }
        else if (want) missed++;
    }
    console.log(`${name.padEnd(34)} right ${String(right).padStart(2)}  wrong ${String(wrong).padStart(2)}  missed ${String(missed).padStart(2)}  ${errors.join(', ')}`);
}

// what the country adds to the rule of 10, and what stays missed
const [base, withCountry] = [rules['min10 x3 byline0.8'], rules['min10 x3 byline0.8 + country']];
console.log('country adds:', judged.filter(e => !base(e) && withCountry(e)).map(e => e.name).join(', '));
console.log('still missed:', judged.filter(e => truth[e.name] && !withCountry(e)).map(e => e.name).join(', '));
