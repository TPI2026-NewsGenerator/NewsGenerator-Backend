// Linking names to Wikidata by the title of a Wikipedia article instead of one search a name: wbgetentities
// takes 50 titles of a wiki a call (sites=<lang>wiki&titles=A|B|...). Of names linked in production (random,
// seen 3 times or more: organisations, persons in full, places), how many have an article of that title, how
// many of those give the item production linked, which differ, and what the ones production left unlinked
// would get. Reads only; sends ~1 call per 50 names to Wikidata. Writes found.json.
// node --env-file=.env bench/title-batch/measure.mjs [per kind, 150]
import fs from 'node:fs';
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';
import {mentionKey} from '../../services/utils/mentions.js';

const PER_KIND = Number(process.argv[2] ?? 150);
const UA = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; rostellofabian@gmail.com)'};
const SITES = {no: 'no', nb: 'no', nn: 'nn', iw: 'he', 'zh-cn': 'zh', 'zh-tw': 'zh', sh: 'sh'};
const wiki = (lang) => `${SITES[lang] ?? lang}wiki`;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let calls = 0;
const ask = async (params) => {
    for (let tries = 0; tries < 8; tries++) {
        calls++;
        const res = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({...params, format: 'json'})}`, {headers: UA});
        if (res.status === 429) { await wait((Number(res.headers.get('retry-after')) || 30) * 1000 + 1000); continue; }
        const answer = await res.json();
        if (answer.error && /busy|maxlag/.test(answer.error.code ?? '')) { await wait(30000); continue; }
        return answer;
    }
    throw new Error('Wikidata kept refusing');
};
const DISAMBIGUATION = new Set(['Q4167410', 'Q13406463', 'Q4167836', 'Q11266439', 'Q15407973', 'Q17442446']);

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const sample = [];
const kinds = [['organization', ''], ['person', "AND key LIKE '% %'"], ['location', '']];
for (const [kind, extra] of kinds) {
    sample.push(...(await db.query(`SELECT id, kind, name, lang, qid, seen FROM mentions WHERE kind = $1 AND linked_at IS NOT NULL AND seen >= 3 ${extra}
        ORDER BY random() LIMIT $2`, [kind, PER_KIND])).rows);
}
await db.end();

// the titles asked by wiki, 50 a call: the language of the name, then English for the ones not found there
const found = new Map();           // mention id -> {site, qid, title, disambiguation}
const lookup = async (rows, siteOf) => {
    const bySite = new Map();
    for (const row of rows) bySite.set(siteOf(row), [...(bySite.get(siteOf(row)) ?? []), row]);
    for (const [site, group] of bySite) {
        for (let i = 0; i < group.length; i += 50) {
            const part = group.slice(i, i + 50);
            const titles = [...new Set(part.map(row => row.name.trim()))];
            const answer = await ask({action: 'wbgetentities', sites: site, titles: titles.join('|'), props: 'sitelinks|claims', sitefilter: site}).catch(() => null);
            await wait(1500);
            if (!answer?.entities) continue;
            const byTitle = new Map();
            for (const entity of Object.values(answer.entities)) {
                if (entity.missing !== undefined) continue;
                const title = entity.sitelinks?.[site]?.title;
                if (!title) continue;
                const p31 = (entity.claims?.P31 ?? []).map(c => c.mainsnak?.datavalue?.value?.id);
                byTitle.set(mentionKey(title), {site, qid: entity.id, title, disambiguation: p31.some(q => DISAMBIGUATION.has(q))});
            }
            for (const row of part) {
                const hit = byTitle.get(mentionKey(row.name));
                if (hit && !found.has(row.id)) found.set(row.id, hit);
            }
        }
    }
};
await lookup(sample, row => wiki(row.lang ?? 'en'));
await lookup(sample.filter(row => !found.has(row.id) && (row.lang ?? 'en') !== 'en'), () => 'enwiki');
fs.writeFileSync(new URL('./found.json', import.meta.url), JSON.stringify({sample, found: [...found]}));

const tally = {};
const diff = [];
for (const row of sample) {
    const hit = found.get(row.id);
    const t = tally[row.kind] ??= {names: 0, found: 0, disambig: 0, same: 0, other: 0, prodNullFound: 0, prodLinked: 0, prodNull: 0};
    t.names++;
    if (row.qid) t.prodLinked++; else t.prodNull++;
    if (!hit) continue;
    t.found++;
    if (hit.disambiguation) { t.disambig++; continue; }
    if (row.qid && hit.qid === row.qid) t.same++;
    else if (row.qid) { t.other++; diff.push({row, hit, why: 'differs'}); }
    else { t.prodNullFound++; diff.push({row, hit, why: 'prod none'}); }
}
console.table(tally);
console.log(`${sample.length} names, ${calls} calls (~${(sample.length / calls).toFixed(1)} names a call)`);
const labels = new Map();
const qids = [...new Set(diff.flatMap(d => [d.row.qid, d.hit.qid]).filter(Boolean))];
for (let i = 0; i < qids.length; i += 10) for (const item of await describeItems(qids.slice(i, i + 10))) labels.set(item.qid, item);
const lab = (qid) => qid ? `${qid} ${labels.get(qid)?.label} (${(labels.get(qid)?.description ?? '').slice(0, 45)}) ${labels.get(qid)?.links}w` : 'none';
for (const d of diff) console.log(`${d.why}\t${d.row.kind[0]} ${d.row.name} [${d.row.lang}] seen ${d.row.seen}\n   prod : ${lab(d.row.qid)}\n   title: ${lab(d.hit.qid)} [${d.hit.site}]`);
