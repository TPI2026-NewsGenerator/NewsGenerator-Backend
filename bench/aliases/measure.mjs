// Would a dictionary of aliases find the item the news name where Wikidata's search does not? The candidates a name
// gets from the Wikipedia of its language (live, the redirects and the disambiguation pages being the aliases
// of a dictionary built from the dumps): the page of that title with its redirects, and when it is a page of
// homonyms the pages it links to ("OL": Olympique lyonnais, Olympique lillois...). Against the candidates
// Wikidata's own search gave (the ones kept by bench/lone-organizations for the judged cases, a new search for
// the extras: the cases of bench/context had the judged items added), for the cases with an item judged right:
// recall of the right item. node --env-file=.env bench/aliases/measure.mjs
import fs from 'node:fs';
import {namedItems} from '../../services/utils/wikidata.js';

const read = (file) => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const cases = read('../context/cases.json').filter(c => c.right.length > 0);
const results = read('../lone-organizations/results.json');
const UA = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const WIKIS = {no: 'no', nb: 'no', iw: 'he'};

const wikipedia = async (lang, params) => {
    for (let tries = 0; tries < 5; tries++) {
        const res = await fetch(`https://${WIKIS[lang] ?? lang}.wikipedia.org/w/api.php?${new URLSearchParams({format: 'json', formatversion: '2', ...params})}`, {headers: UA});
        if (res.status === 429) { await wait(15000); continue; }
        if (!res.ok) return null;
        return res.json();
    }
    return null;
};
// {primary: qid, homonyms: [qid]} of a title in a Wikipedia
const aliasesOf = async (lang, name) => {
    const first = await wikipedia(lang, {action: 'query', titles: name, redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item|disambiguation'});
    const page = first?.query?.pages?.[0];
    if (!page || page.missing) return {primary: null, homonyms: []};
    const qid = page.pageprops?.wikibase_item ?? null;
    if (page.pageprops?.disambiguation === undefined) return {primary: qid, homonyms: []};
    const links = await wikipedia(lang, {action: 'query', generator: 'links', titles: page.title, gplnamespace: '0', gpllimit: '100', prop: 'pageprops', ppprop: 'wikibase_item'});
    return {primary: null, homonyms: (links?.query?.pages ?? []).map(p => p.pageprops?.wikibase_item).filter(Boolean)};
};

const rows = [];
for (const c of cases) {
    const lang = c.lang ?? 'en';
    let search;
    if (c.suite === 'judged') {
        const result = results.find(r => r.id === c.id);
        search = (result?.candidates ?? []).map(text => text.split(' ')[0]);
    } else {
        for (let tries = 0; ; tries++) {
            try { search = (await namedItems(c.name, lang)).map(item => item.qid); break; } catch (err) { if (!err.paused || tries > 5) throw err; await wait(35000); }
        }
        await wait(1000);
    }
    let aliases = await aliasesOf(lang, c.name);
    if (!aliases.primary && aliases.homonyms.length === 0 && lang !== 'en') aliases = await aliasesOf('en', c.name);
    await wait(300);
    const wiki = [aliases.primary, ...aliases.homonyms].filter(Boolean);
    const union = [...new Set([...search, ...wiki])];
    const hit = (list) => c.right.some(qid => list.includes(qid));
    rows.push({suite: c.suite, name: c.name, lang, search: search.length, wiki: wiki.length, union: union.length, inSearch: hit(search), inWiki: hit(wiki), inUnion: hit(union)});
}
fs.writeFileSync(new URL('./measure.json', import.meta.url), JSON.stringify(rows, null, 1));
for (const suite of ['judged', 'extras', 'all']) {
    const set = rows.filter(r => suite === 'all' || r.suite === suite);
    const count = (key) => set.filter(r => r[key]).length;
    const mean = (key) => (set.reduce((n, r) => n + r[key], 0) / set.length).toFixed(1);
    console.log(`${suite.padEnd(7)} ${set.length} cases with an item right: in the search ${count('inSearch')}, in the Wikipedia aliases ${count('inWiki')}, in both together ${count('inUnion')}; candidates a name: search ${mean('search')}, aliases ${mean('wiki')}, together ${mean('union')}`);
}
console.log('\nfound only by the aliases:');
for (const r of rows.filter(r => !r.inSearch && r.inWiki)) console.log(`  ${r.name} [${r.lang}] (${r.wiki} candidates)`);
console.log('found only by the search:');
for (const r of rows.filter(r => r.inSearch && !r.inWiki)) console.log(`  ${r.name} [${r.lang}]`);
console.log('found by neither:');
for (const r of rows.filter(r => !r.inUnion)) console.log(`  ${r.name} [${r.lang}] (search ${r.search}, aliases ${r.wiki})`);
