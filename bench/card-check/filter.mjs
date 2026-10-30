// Cheap signals telling which linked names of a card are worth the AI check, scored against the judged links
// (truth.json) and the AI's own answers (verdicts.json): of the wrong ones how many a filter sends to the AI
// (caught), of the AI's "no" on right ones (7: dropped for nothing) how many it sends, and the share of all
// names it sends (the cost). Signals: TYPE (a person that is no human, a body that is), LOW (few Wikipedias),
// COUNTRY (the item's country is none of the countries of the card's sites), SIM (the item's text far from the
// titles, bge-m3). node --env-file=.env bench/card-check/filter.mjs
import fs from 'node:fs';
import {embed, denseSimilarity} from '../../services/utils/embedder.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const entries = read('./cards.json');
const truth = read('./truth.json');
const verdicts = read('./verdicts.json');
const file = new URL('./sims.json', import.meta.url);
let sims = fs.existsSync(file) ? read('./sims.json') : null;
if (!sims) {
    sims = [];
    for (let i = 0; i < entries.length; i += 20) {
        const part = entries.slice(i, i + 20);
        const texts = part.flatMap(e => [`${e.label}: ${e.description ?? ''}`, ...e.titles]);
        const vectors = await embed(texts);
        let at = 0;
        for (const e of part) {
            const item = vectors[at++];
            const titles = vectors.slice(at, at + e.titles.length);
            at += e.titles.length;
            const top = titles.map(t => denseSimilarity(item.dense, t.dense)).sort((a, b) => b - a).slice(0, 3);
            sims.push(top.reduce((a, b) => a + b, 0) / (top.length || 1));
        }
    }
    fs.writeFileSync(file, JSON.stringify(sims));
}
const signals = {
    TYPE: (e) => (e.kind === 'person' && !e.human) || (e.kind === 'organization' && e.human),
    LOW10: (e) => e.links <= 10,
    LOW20: (e) => e.links <= 20,
    COUNTRY: (e) => Boolean(e.itemCountry) && !e.international && Object.keys(e.sites).length > 0 && !e.sites[e.itemCountry],
    SIM30: (e, i) => sims[i] < 0.30,
    SIM35: (e, i) => sims[i] < 0.35,
    SIM40: (e, i) => sims[i] < 0.40,
};
const wrong = entries.map((e, i) => i).filter(i => truth[i] === 'W');
const falseDrops = entries.map((e, i) => i).filter(i => truth[i] !== 'W' && verdicts[i] === 'no');
const caught = wrong.filter(i => verdicts[i] === 'no');
const report = (name, flag) => {
    const sent = entries.map((e, i) => i).filter(i => flag(entries[i], i));
    console.log(`${name.padEnd(34)} sent ${String(sent.length).padStart(3)} of ${entries.length} (${Math.round(100 * sent.length / entries.length)}%)  wrong ${wrong.filter(i => sent.includes(i)).length}/${wrong.length}  AI-caught ${caught.filter(i => sent.includes(i)).length}/${caught.length}  false drops ${falseDrops.filter(i => sent.includes(i)).length}/${falseDrops.length}`);
};
for (const [name, flag] of Object.entries(signals)) report(name, flag);
const any = (...names) => (e, i) => names.some(name => signals[name](e, i));
report('TYPE | LOW10 | COUNTRY', any('TYPE', 'LOW10', 'COUNTRY'));
report('TYPE | LOW10 | COUNTRY | SIM30', any('TYPE', 'LOW10', 'COUNTRY', 'SIM30'));
report('TYPE | LOW10 | COUNTRY | SIM35', any('TYPE', 'LOW10', 'COUNTRY', 'SIM35'));
report('TYPE | LOW20 | COUNTRY | SIM35', any('TYPE', 'LOW20', 'COUNTRY', 'SIM35'));
report('TYPE | LOW20 | COUNTRY | SIM40', any('TYPE', 'LOW20', 'COUNTRY', 'SIM40'));
console.log('\nthe wrong ones missed by TYPE|LOW20|COUNTRY|SIM35:');
for (const i of wrong.filter(i => !any('TYPE', 'LOW20', 'COUNTRY', 'SIM35')(entries[i], i))) console.log(`${i} ${entries[i].name} -> ${entries[i].label} links ${entries[i].links} country ${entries[i].itemCountry} sites ${JSON.stringify(entries[i].sites)} sim ${sims[i].toFixed(2)} AI ${verdicts[i]}`);
