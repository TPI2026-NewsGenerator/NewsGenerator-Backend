//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: items.mjs
//  Description: The items the organisations are linked to, read once from Wikidata (50 a call, a pause of
//               5 s between calls, waiting as asked on 429): their English label and description, their
//               Wikipedias (sitelinks), what they are an instance of (P31), the properties they have (P625
//               a position on Earth, P577 a date of publication, P159 a seat...). Then the labels of the
//               P31 met, for the rules of score.mjs. Writes items.json and classes.json. Read-only on the
//               database
//               node --env-file=.env bench/lone-organizations/items.mjs
//

import fs from 'node:fs';
import pg from 'pg';

const PAUSE_MS = 5000;
const BATCH = 50;
const OUT = new URL('./items.json', import.meta.url);
const CLASSES = new URL('./classes.json', import.meta.url);
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; self-hosted news reader, bench)', Accept: 'application/json'};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const entities = async (qids, props) => {
    for (;;) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: qids.join('|'), props, languages: 'en', format: 'json'});
        // the connection lost (a timeout, a reset): again after a while
        const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: HEADERS}).catch(() => null);
        if (!res || res.status === 429 || res.status >= 500) {
            await wait((Number(res?.headers.get('retry-after')) * 1000 || 30e3) + 1000);
            continue;
        }
        const answer = await res.json();
        await wait(PAUSE_MS);
        return Object.values(answer.entities ?? {}).filter(item => item.missing === undefined);
    }
};
const targets = (claims, property) => (claims?.[property] ?? []).filter(claim => claim.rank !== 'deprecated')
    .map(claim => claim.mainsnak?.datavalue?.value?.id).filter(Boolean);

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT DISTINCT qid FROM mentions WHERE kind = 'organization' AND qid IS NOT NULL`);
await db.end();

const items = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const left = rows.map(row => row.qid).filter(qid => !(qid in items));
for (let i = 0; i < left.length; i += BATCH) {
    const batch = left.slice(i, i + BATCH);
    for (const item of await entities(batch, 'labels|descriptions|claims|sitelinks')) {
        items[item.id] = {
            qid: item.id, label: item.labels?.en?.value ?? null, description: item.descriptions?.en?.value ?? null,
            links: Object.keys(item.sitelinks ?? {}).length, p31: targets(item.claims, 'P31'), props: Object.keys(item.claims ?? {}),
        };
    }
    batch.filter(qid => !(qid in items)).forEach(qid => { items[qid] = {qid, missing: true}; });
    fs.writeFileSync(OUT, JSON.stringify(items));
    console.log(`${Math.min(i + BATCH, left.length)}/${left.length}`);
}

// the labels of the classes, the most met first
const counts = new Map();
for (const item of Object.values(items)) for (const p31 of item.p31 ?? []) counts.set(p31, (counts.get(p31) ?? 0) + 1);
const classes = fs.existsSync(CLASSES) ? JSON.parse(fs.readFileSync(CLASSES)) : {};
const unread = [...counts.keys()].filter(qid => !(qid in classes));
for (let i = 0; i < unread.length; i += BATCH) {
    for (const item of await entities(unread.slice(i, i + BATCH), 'labels')) classes[item.id] = {label: item.labels?.en?.value ?? item.id};
    console.log(`classes ${Math.min(i + BATCH, unread.length)}/${unread.length}`);
}
for (const [qid, count] of counts) if (classes[qid]) classes[qid].items = count;
fs.writeFileSync(CLASSES, JSON.stringify(Object.fromEntries(Object.entries(classes).sort((a, b) => (b[1].items ?? 0) - (a[1].items ?? 0))), null, 1));
