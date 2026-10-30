// The Wikipedia search for each name of sample.json: generator=search on <lang>.wikipedia.org, 5 results with
// the item of each page (pageprops wikibase_item, disambiguation), the name as written and between quotes, then
// on the English one for a name of another language. Sequential, no pause: what the API lets through (the
// refusals, their Retry-After, the milliseconds a call), then every item found described (batched) as the
// link of a name must be (kind, label).
// node --env-file=.env bench/wiki-search/search.mjs
import fs from 'node:fs';
import {describeItems, wikimediaHeaders} from '../../services/utils/wikidata.js';

const WIKIS = {no: 'no', nb: 'no', iw: 'he', 'zh-cn': 'zh', 'zh-tw': 'zh'};
const hostOf = (lang) => `${WIKIS[lang] ?? lang ?? 'en'}.wikipedia.org`;
const sample = JSON.parse(fs.readFileSync(new URL('./sample.json', import.meta.url), 'utf8'));

const stats = {calls: 0, ms: 0, refused: 0, waited: 0, failed: 0, retryAfters: {}};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// one search; a 429 is waited for as long as Retry-After says (plus 0.2 s) then asked again, 6 times at most
const search = async (host, text) => {
    for (let tries = 0; tries < 6; tries++) {
        const started = Date.now();
        stats.calls++;
        try {
            const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({action: 'query', generator: 'search', gsrsearch: text, gsrnamespace: '0',
                gsrlimit: '5', prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', format: 'json', formatversion: '2'})}`,
            {headers: wikimediaHeaders(), signal: AbortSignal.timeout(20000)});
            stats.ms += Date.now() - started;
            if (res.status === 429 || res.status >= 500) {
                const after = Number(res.headers.get('retry-after')) || 5;
                stats.refused++;
                stats.retryAfters[after] = (stats.retryAfters[after] ?? 0) + 1;
                stats.waited += after + 0.2;
                await wait((after + 0.2) * 1000);
                continue;
            }
            if (!res.ok) { stats.failed++; return null; }
            const pages = ((await res.json()).query?.pages ?? []).sort((a, b) => a.index - b.index);
            return pages.map(page => ({title: page.title, qid: page.pageprops?.wikibase_item ?? null, disambiguation: page.pageprops?.disambiguation !== undefined}));
        } catch {
            stats.failed++;
            return null;
        }
    }
    stats.failed++;
    return null;
};

const results = [];
const began = Date.now();
for (const row of sample) {
    const host = hostOf(row.lang);
    const out = {id: row.id, plain: await search(host, row.name), quoted: await search(host, `"${row.name}"`)};
    if (host !== 'en.wikipedia.org') out.english = await search('en.wikipedia.org', row.name);
    results.push(out);
}
const seconds = (Date.now() - began) / 1000;

const qids = new Set();
for (const row of sample) if (row.qid) qids.add(row.qid);
for (const out of results) for (const list of [out.plain, out.quoted, out.english]) for (const hit of list ?? []) if (hit.qid) qids.add(hit.qid);
const items = {};
const all = [...qids];
const out_ = new URL('./results.json', import.meta.url);
fs.writeFileSync(out_, JSON.stringify({stats, seconds, results, items}, null, 1));
for (let i = 0; i < all.length; i += 50) {
    // Wikidata asks to wait (429 or "too busy", the production loop shares this address): as asked, then again
    for (let tries = 0; ; tries++) {
        try {
            for (const item of await describeItems(all.slice(i, i + 50), {batch: 50})) items[item.qid] = item;
            break;
        } catch (err) {
            if (!err.paused || tries >= 8) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 10000) + 1000));
        }
    }
}
fs.writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({stats, seconds, results, items}, null, 1));
console.log(`${stats.calls} calls in ${seconds.toFixed(1)} s (${(stats.calls / seconds).toFixed(1)}/s, ${Math.round(stats.ms / stats.calls)} ms a call), refused ${stats.refused} (waited ${stats.waited.toFixed(0)} s, Retry-After ${JSON.stringify(stats.retryAfters)}), failed ${stats.failed}, ${all.length} items described`);
