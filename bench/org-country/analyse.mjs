// Among the judged organisations the rule of organization-items.js keeps now (no human, place nor work, 2
// Wikipedias at least), the wrong ones against the right ones: what the media countries tell
// node bench/org-country/analyse.mjs
import fs from 'node:fs';
const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const features = read('./features.json');
const results = read('../lone-organizations/results.json');
const BODY = ['P159', 'P118', 'P641', 'P452', 'P112', 'P1454', 'P749', 'P488', 'P169', 'P1128', 'P414', 'P127', 'P355'];
const kept = (e) => {
    const r = results.find(x => x.id === e.id && x.qid === e.qid);
    if (!r) return e.extra ? true : null;               // the three found by the audit were kept
    const has = (p) => r.props.includes(p);
    const human = r.p31.includes('Q5');
    const place = !has('P297') && (has('P1082') || (has('P625') && !BODY.some(has)) || r.p31.includes('Q486972'));
    return !human && !place && !has('P577') && r.links >= 2;
};
const share = (e) => {
    const inCountries = Object.values(e.byCountry).reduce((a, b) => a + b, 0);
    return {inCountries, own: e.itemCountry ? (e.byCountry[e.itemCountry] ?? 0) / (inCountries || 1) : null};
};
let right = 0, wrong = 0, country = 0;
const rows = [];
for (const e of features) {
    if (!kept(e)) continue;
    const {inCountries, own} = share(e);
    rows.push({verdict: e.verdict, name: e.name, lang: e.lang, links: e.links ?? '?', item: e.itemCountry, int: e.international, news: e.total, inCountries, own: own === null ? '-' : own.toFixed(2)});
    if (e.verdict === true) right++; else if (e.verdict === false) wrong++; else country++;
}
console.log(`kept now: ${right} right, ${country} country, ${wrong} wrong`);
console.table(rows.filter(r => r.verdict !== true));
console.log('right ones with an item country and few of its own sites (own < 0.1, 3+ news in countries):');
console.table(rows.filter(r => r.verdict === true && r.item && !r.int && r.inCountries >= 3 && r.own !== '-' && Number(r.own) < 0.1));

// candidate guards sending a kept item to the AI: A: one country writes DOMINANT of the news of the sites with
// a country (20+ of them) and the item is of another; B: none of the sites is of the item's country (20+ news
// in countries) and the item is not an American one (no ccTLD: .com, .org)
console.log('\nguards on the kept ones:');
for (const [dominant, minNews] of [[0.7, 20], [0.8, 20], [0.9, 20], [0.8, 10]]) {
    for (const withB of [false, true]) {
        const flagged = rows.map((r, i) => ({r, e: features.filter(e => kept(e))[i]})).filter(({e}) => {
            if (!e.itemCountry || e.international) return false;
            const total = Object.values(e.byCountry).reduce((a, b) => a + b, 0);
            if (total < minNews) return false;
            const [top, news] = Object.entries(e.byCountry).sort((a, b) => b[1] - a[1])[0];
            const a = top !== e.itemCountry && news >= dominant * total;
            const b = withB && e.itemCountry !== 'US' && (e.byCountry[e.itemCountry] ?? 0) === 0;
            return a || b;
        });
        const by = (v) => flagged.filter(({e}) => e.verdict === v).length;
        console.log(`dominant ${dominant} (${minNews}+ news)${withB ? ' + B' : ''}: flagged ${flagged.length}: wrong caught ${by(false)} of 4, country ${by('country')}, right sent to the AI ${by(true)} of 69`
            + (by(true) <= 8 ? ` [${flagged.filter(({e}) => e.verdict === true).map(({e}) => e.name).join(', ')}]` : ''));
    }
}
