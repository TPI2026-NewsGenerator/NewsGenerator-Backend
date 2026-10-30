//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: items.mjs
//  Description: The items the persons of a full name are linked to, read once from Wikidata (50 a call,
//               a pause of 5 s between calls, waiting as asked on 429): their Wikipedias (sitelinks), their
//               English description, whether they are a human. Writes items.json for bench.mjs. Read-only
//               on the database
//               node --env-file=.env bench/lone-items/items.mjs
//

import fs from 'node:fs';
import pg from 'pg';

const PAUSE_MS = 5000;
const BATCH = 50;
const OUT = new URL('./items.json', import.meta.url);
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; self-hosted news reader, bench)', Accept: 'application/json'};
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const read = async (qids) => {
    for (;;) {
        const params = new URLSearchParams({action: 'wbgetentities', ids: qids.join('|'), props: 'claims|sitelinks|descriptions', languages: 'en', format: 'json'});
        const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: HEADERS});
        if (res.status === 429) {
            await wait((Number(res.headers.get('retry-after')) * 1000 || 30e3) + 1000);
            continue;
        }
        const entities = (await res.json()).entities ?? {};
        await wait(PAUSE_MS);
        return Object.values(entities).filter(item => item.missing === undefined).map(item => ({
            qid: item.id,
            description: item.descriptions?.en?.value ?? null,
            links: Object.keys(item.sitelinks ?? {}).length,
            human: (item.claims?.P31 ?? []).some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5'),
        }));
    }
};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`SELECT DISTINCT qid FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key LIKE '% %'`);
await db.end();

const items = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const left = rows.map(row => row.qid).filter(qid => !(qid in items));
for (let i = 0; i < left.length; i += BATCH) {
    const batch = left.slice(i, i + BATCH);
    for (const item of await read(batch)) items[item.qid] = item;
    batch.filter(qid => !(qid in items)).forEach(qid => { items[qid] = {qid, missing: true}; });
    fs.writeFileSync(OUT, JSON.stringify(items));
    console.log(`${Math.min(i + BATCH, left.length)}/${left.length}`);
}
