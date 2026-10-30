// The same sample (found.json of measure.mjs), the titles resolved by the Wikipedia of the language instead:
// action=query&titles=A|B|...&redirects=1&prop=pageprops (wikibase_item, disambiguation), 50 a call, on
// <lang>.wikipedia.org (its own limit, not Wikidata's): redirects ("Real Madrid" -> "Real Madrid CF") and the
// case of a title ("Lvmh") are resolved there. Then the filters a link of a name must pass: no
// disambiguation page, an item of the kind of the name (a person is a human, an organisation no place nor
// human, a place no human nor work), a label that is no common noun (lower case: "motorsport", "bus driver").
// node --env-file=.env bench/title-batch/measure2.mjs
import fs from 'node:fs';
import {describeItems} from '../../services/utils/wikidata.js';

const UA = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const WIKIS = {no: 'no', nb: 'no', iw: 'he'};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const {sample, found: foundByTitle} = JSON.parse(fs.readFileSync(new URL('./found.json', import.meta.url), 'utf8'));
const byTitleOld = new Map(foundByTitle);
let calls = 0;
const ask = async (host, titles) => {
    for (let tries = 0; tries < 6; tries++) {
        calls++;
        const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({action: 'query', titles: titles.join('|'), redirects: '1', prop: 'pageprops',
            ppprop: 'wikibase_item|disambiguation', format: 'json', formatversion: '2'})}`, {headers: UA});
        if (res.status === 429 || res.status >= 500) { await wait(15000); continue; }
        return res.ok ? res.json() : null;
    }
    return null;
};
const lookup = async (rows, hostOf) => {
    const result = new Map();
    const groups = new Map();
    for (const row of rows) groups.set(hostOf(row), [...(groups.get(hostOf(row)) ?? []), row]);
    for (const [host, group] of groups) {
        for (let i = 0; i < group.length; i += 50) {
            const part = group.slice(i, i + 50);
            const answer = await ask(host, [...new Set(part.map(row => row.name.trim()))]);
            await wait(300);
            if (!answer?.query) continue;
            // the title asked -> the page it ends at: normalized, then redirected
            const next = new Map();
            for (const n of answer.query.normalized ?? []) next.set(n.from, n.to);
            const redirected = new Map();
            for (const r of answer.query.redirects ?? []) redirected.set(r.from, r.to);
            const pages = new Map((answer.query.pages ?? []).filter(p => !p.missing).map(p => [p.title, p]));
            for (const row of part) {
                let title = row.name.trim();
                title = next.get(title) ?? title;
                title = redirected.get(title) ?? title;
                const page = pages.get(title);
                if (page?.pageprops?.wikibase_item) result.set(row.id, {qid: page.pageprops.wikibase_item, title: page.title, disambiguation: page.pageprops.disambiguation !== undefined, host});
            }
        }
    }
    return result;
};
const host = (row) => `${({no: 'no', nb: 'no', iw: 'he'})[row.lang ?? 'en'] ?? row.lang ?? 'en'}.wikipedia.org`;
const first = await lookup(sample, host);
const second = await lookup(sample.filter(row => !first.has(row.id) && (row.lang ?? 'en') !== 'en'), () => 'en.wikipedia.org');
const found = new Map([...second, ...first]);

// the items, for the filters
const qids = [...new Set([...found.values()].map(f => f.qid))];
const items = new Map();
for (let i = 0; i < qids.length; i += 10) {
    for (;;) {
        try { for (const item of await describeItems(qids.slice(i, i + 10))) items.set(item.qid, item); break; } catch (err) { if (!err.paused) throw err; await wait(65000); }
    }
    await wait(300);
}
const okFor = (row, item) => {
    if (!item) return false;
    if (row.kind === 'person') return item.human;
    if (row.kind === 'organization') return !item.human && !item.place && !item.work;
    return !item.human && !item.work;
};
const common = (item) => /^\p{Ll}/u.test(item.label ?? '');
const tally = {};
const out = [];
for (const row of sample) {
    const hit = found.get(row.id);
    const t = tally[row.kind] ??= {names: 0, found: 0, disambig: 0, filtered: 0, kept: 0, same: 0, other: 0, prodNullKept: 0, prodLinked: 0, prodNull: 0};
    t.names++;
    if (row.qid) t.prodLinked++; else t.prodNull++;
    if (!hit) continue;
    t.found++;
    if (hit.disambiguation) { t.disambig++; continue; }
    const item = items.get(hit.qid);
    if (!okFor(row, item) || common(item) || /disambiguation page/i.test(item.description ?? '')) { t.filtered++; continue; }
    t.kept++;
    if (row.qid && hit.qid === row.qid) t.same++;
    else if (row.qid) { t.other++; out.push({row, hit, item, why: 'differs'}); }
    else { t.prodNullKept++; out.push({row, hit, item, why: 'prod none'}); }
}
console.table(tally);
const sum = (k) => Object.values(tally).reduce((a, t) => a + t[k], 0);
console.log(`${sample.length} names, ${calls} calls; found ${sum('found')}, disambiguation ${sum('disambig')}, filtered ${sum('filtered')}, kept ${sum('kept')} (same as production ${sum('same')}, differs ${sum('other')}, production none ${sum('prodNullKept')})`);
const qs = [...new Set(out.map(o => o.row.qid).filter(Boolean))];
const prodItems = new Map();
for (let i = 0; i < qs.length; i += 10) for (const item of await describeItems(qs.slice(i, i + 10))) prodItems.set(item.qid, item);
const lab = (qid, item) => `${qid} ${item?.label} (${(item?.description ?? '').slice(0, 42)}) ${item?.links}w`;
for (const o of out) console.log(`${o.why}\t${o.row.kind[0]} ${o.row.name} [${o.row.lang}] seen ${o.row.seen}${o.row.qid ? `\n   prod : ${lab(o.row.qid, prodItems.get(o.row.qid))}` : ''}\n   title: ${lab(o.hit.qid, o.item)} [${o.hit.title}]`);
