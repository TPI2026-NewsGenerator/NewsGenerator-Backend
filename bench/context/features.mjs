// For each case of cases.json, what the context says of each candidate item: the cosine (bge-m3, dense) of
// the item's text ("label: description") with each title of the news naming the name, the item's country.
// Writes features.json. node --env-file=.env bench/context/features.mjs
import fs from 'node:fs';
import {embed, denseSimilarity} from '../../services/utils/embedder.js';
import {readCountries} from '../../services/utils/wikidata.js';

const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 20) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
};
const text = (item) => `${item.label}: ${item.description ?? ''}`.trim();
const qids = [...new Set(cases.flatMap(c => c.candidates.map(item => item.qid)))];
const countries = new Map();
for (let i = 0; i < qids.length; i += 40) {
    for (const [qid, country] of await patient(() => readCountries(qids.slice(i, i + 40)))) countries.set(qid, country);
    await new Promise(resolve => setTimeout(resolve, 300));
}
const out = [];
for (const c of cases) {
    const texts = [...c.candidates.map(text), ...c.titles];
    const vectors = c.titles.length === 0 ? [] : await embed(texts);
    const titleVectors = vectors.slice(c.candidates.length);
    out.push({id: c.id, name: c.name, lang: c.lang, candidates: c.candidates.map((item, i) => ({
        qid: item.qid,
        sims: titleVectors.map(title => denseSimilarity(vectors[i].dense, title.dense)),
        country: countries.get(item.qid)?.country ?? null, international: countries.get(item.qid)?.international ?? false,
    }))});
    if (out.length % 20 === 0) console.log(`${out.length} of ${cases.length}`);
}
fs.writeFileSync(new URL('./features.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} cases, embedded`);
