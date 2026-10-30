// The requests of mgenre/server.py (POST /rank) for the cases of bench/context (cases.json): for each name, the
// sentence naming it (a title of its news holding the name, marked [START] ... [END]; else the name followed by
// the first titles) and the titles of its candidates: the title of their article in the English Wikipedia
// ("S.S.C. Napoli >> en"), else in the Wikipedia of the name's language, else their label of Wikidata (the model
// knows the titles of Wikipedia, not the labels: "SSC Napoli" is "S.S.C. Napoli"). Writes requests.json.
// node bench/mgenre/requests.mjs
import fs from 'node:fs';

const cases = JSON.parse(fs.readFileSync(new URL('../context/cases.json', import.meta.url), 'utf8'));
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const UA = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const WIKIS = {no: 'no', nb: 'no', iw: 'he'};
const wikiOf = (lang) => `${WIKIS[lang] ?? lang ?? 'en'}wiki`;

// Map qid -> {site: title} of the articles of these items in these wikis, 50 items a call
const sitelinks = async (qids, sites) => {
    const found = new Map();
    for (let i = 0; i < qids.length; i += 50) {
        for (let tries = 0; tries < 8; tries++) {
            const res = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({action: 'wbgetentities', ids: qids.slice(i, i + 50).join('|'),
                props: 'sitelinks', sitefilter: sites.join('|'), format: 'json'})}`, {headers: UA});
            if (res.status === 429) { await wait(30000); continue; }
            const answer = await res.json();
            if (answer.error) { await wait(30000); continue; }
            for (const [qid, entity] of Object.entries(answer.entities ?? {})) {
                found.set(qid, Object.fromEntries(Object.entries(entity.sitelinks ?? {}).map(([site, link]) => [site, link.title])));
            }
            break;
        }
        await wait(1500);
    }
    return found;
};
const links = await sitelinks([...new Set(cases.flatMap(c => c.candidates.map(item => item.qid)))],
    [...new Set(['enwiki', ...cases.map(c => wikiOf(c.lang))])]);
const MAX_SOURCE_CHARS = 300;
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// {source, marked}: marked when the name is in one of the titles
const sourceOf = (c) => {
    const name = c.name.trim();
    for (const title of c.titles) {
        const at = title.toLowerCase().indexOf(name.toLowerCase());
        if (at >= 0) {
            return {marked: true, source: `${title.slice(0, at)}[START] ${title.slice(at, at + name.length)} [END]${title.slice(at + name.length)}`.slice(0, MAX_SOURCE_CHARS)};
        }
    }
    return {marked: false, source: `[START] ${name} [END] ${c.titles.slice(0, 2).join('. ')}`.slice(0, MAX_SOURCE_CHARS)};
};
const requests = cases.map((c, index) => {
    const candidates = c.candidates.filter(item => item.label && !/^Q\d+$/.test(item.label)).slice(0, 16);
    return {id: String(index), name: c.name, lang: c.lang, qids: candidates.map(item => item.qid), ...sourceOf(c),
        targets: candidates.map(item => {
            const own = links.get(item.qid) ?? {};
            if (own.enwiki) return `${own.enwiki} >> en`;
            const site = wikiOf(c.lang);
            return own[site] ? `${own[site]} >> ${site.replace(/wiki$/, '')}` : `${cap(item.label)} >> en`;
        }),
        titled: candidates.filter(item => (links.get(item.qid) ?? {}).enwiki || (links.get(item.qid) ?? {})[wikiOf(c.lang)]).length};
});
fs.writeFileSync(new URL('./requests.json', import.meta.url), JSON.stringify(requests, null, 1));
console.log(`${requests.length} requests, ${requests.filter(r => r.marked).length} with the name in a title, ${requests.reduce((n, r) => n + r.targets.length, 0)} targets, ${requests.reduce((n, r) => n + r.titled, 0)} with the title of an article`);
