// A blind bench of names to link: names drawn at random (seeded) from the cards of the last briefings, each with
// the candidates Wikidata's search gives, the pages of its title and its homonyms in the Wikipedia of the card's
// language, and the item the card showed (when it had one), mixed in a seeded order so that nothing says which one
// the system chose. judge.txt is what is read to judge (the right item, none, or unsure) before any system is
// run on items.json. Read only. node --env-file=.env bench/blind/sample.mjs [names, 240]
import fs from 'node:fs';
import pg from 'pg';
import {namedItems, describeItems} from '../../services/utils/wikidata.js';
import {mentionKey} from '../../services/utils/mentions.js';
import {countryOfSite} from '../../services/utils/country-names.js';
import {prisma} from '../../config/db.js';

const N = Number(process.argv[2] ?? 240);
const IDS = [228, 207, 206, 201, 191, 190, 173, 172, 167, 143, 105, 104, 100, 98, 96, 91];
const MAX_PER_CARD = 3;
const MAX_CANDIDATES = 10;
const UA = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const WIKIS = {no: 'no', nb: 'no', iw: 'he'};

// a seeded generator, the same sample and the same order every run
const seeded = (seed) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const random = seeded(20261022);
const shuffled = (list) => list.map(item => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 8) throw err;
            await wait((err.retryIn ?? 35000) + 1000);
        }
    }
};
const wikipedia = async (lang, params) => {
    for (let tries = 0; tries < 5; tries++) {
        const res = await fetch(`https://${WIKIS[lang] ?? lang}.wikipedia.org/w/api.php?${new URLSearchParams({format: 'json', formatversion: '2', ...params})}`, {headers: UA});
        if (res.status === 429) { await wait(15000); continue; }
        return res.ok ? res.json() : null;
    }
    return null;
};
// the item of the page of a title and, for a page of homonyms, the items of the pages it links to
const aliasesOf = async (lang, name) => {
    const first = await wikipedia(lang, {action: 'query', titles: name, redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item|disambiguation'});
    const page = first?.query?.pages?.[0];
    if (!page || page.missing) return [];
    if (page.pageprops?.disambiguation === undefined) return page.pageprops?.wikibase_item ? [page.pageprops.wikibase_item] : [];
    const links = await wikipedia(lang, {action: 'query', generator: 'links', titles: page.title, gplnamespace: '0', gpllimit: '40', prop: 'pageprops', ppprop: 'wikibase_item'});
    return (links?.query?.pages ?? []).map(p => p.pageprops?.wikibase_item).filter(Boolean);
};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT id, items FROM briefings WHERE id = ANY($1::int[]) ORDER BY id DESC`, [IDS]);
await db.end();
const seen = new Set();
const all = [];
for (const b of rows) {
    for (const card of b.items) {
        if (seen.has(card.storyId) || card.storyId < 0) continue;
        seen.add(card.storyId);
        const articles = [card.lead, ...(card.articles ?? [])].filter(Boolean);
        const titles = [...new Set(articles.map(a => a.title))].slice(0, 4);
        const sites = {};
        for (const a of articles) { const c = countryOfSite(a.source ?? ''); if (c) sites[c] = (sites[c] ?? 0) + 1; }
        for (const name of card.names ?? []) {
            all.push({briefing: b.id, storyId: card.storyId, name: name.name, kind: name.kind, prodQid: name.qid ?? null, lang: card.language ?? 'en',
                topic: card.topic ?? null, titles, sites, countries: card.countries ?? [], others: (card.names ?? []).filter(n => n !== name).map(n => n.name)});
        }
    }
}
// the draw: at most MAX_PER_CARD names of a card, a name once whatever its card
const taken = new Map();
const keys = new Set();
const chosen = [];
for (const entry of shuffled(all)) {
    const key = `${entry.kind}|${mentionKey(entry.name)}`;
    if (keys.has(key) || (taken.get(entry.storyId) ?? 0) >= MAX_PER_CARD) continue;
    keys.add(key);
    taken.set(entry.storyId, (taken.get(entry.storyId) ?? 0) + 1);
    chosen.push(entry);
    if (chosen.length >= N) break;
}
console.log(`${all.length} names on ${seen.size} cards, ${chosen.length} drawn (${chosen.filter(e => e.prodQid).length} with the item the card showed)`);

for (const [i, entry] of chosen.entries()) {
    const lang = entry.lang === 'null' ? 'en' : entry.lang;
    const search = (await patient(() => namedItems(entry.name, lang)).catch(() => [])).map(item => item.qid);
    await wait(900);
    const aliases = await aliasesOf(lang, entry.name);
    await wait(250);
    entry.qids = [...new Set([entry.prodQid, ...aliases.slice(0, 1), ...search, ...aliases.slice(1)].filter(Boolean))].slice(0, MAX_CANDIDATES);
    if ((i + 1) % 40 === 0) console.log(`${i + 1} of ${chosen.length} candidates found`);
}
const items = new Map();
const qids = [...new Set(chosen.flatMap(e => e.qids))];
for (let i = 0; i < qids.length; i += 50) {
    for (const item of await patient(() => describeItems(qids.slice(i, i + 50), {batch: 50}))) items.set(item.qid, item);
    await wait(1500);
}
const out = chosen.map((entry, i) => {
    const candidates = shuffled(entry.qids.map(qid => items.get(qid)).filter(Boolean));
    const {qids: _unused, ...rest} = entry;
    return {i, ...rest, candidates};
});
fs.writeFileSync(new URL('./items.json', import.meta.url), JSON.stringify(out, null, 1));
const text = out.map(e => `#${e.i} ${e.name} (${e.kind}) [${e.lang}] topic ${e.topic ?? '-'} | ${e.titles.slice(0, 2).map(t => t.slice(0, 95)).join(' // ')} | with: ${e.others.slice(0, 3).join(', ') || '-'}\n`
    + (e.candidates.length === 0 ? '   (no candidate)\n' : e.candidates.map((c, k) => `   ${k + 1}) ${c.label} - ${(c.description || '').slice(0, 70)} (${c.links}w)`).join('\n') + '\n')).join('');
fs.writeFileSync(new URL('./judge.txt', import.meta.url), text);
console.log(`${out.length} names written, ${out.filter(e => e.candidates.length === 0).length} with no candidate, ${out.reduce((n, e) => n + e.candidates.length, 0)} candidates`);
await prisma.$disconnect();
