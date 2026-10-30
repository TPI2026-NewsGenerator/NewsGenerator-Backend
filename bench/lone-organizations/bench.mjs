//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: bench.mjs
//  Description: Measure of the rule linking an organisation to the one item of Wikidata called so, whatever
//               it is ("Al-Hazm", the Saudi club, became a human settlement in Oman in 2 Wikipedias,
//               20.10.2026). Takes organisations linked, the most met, as many at random, and at random among
//               the ones whose item is a human, a place (P625), a work (P577) or in 0-2 Wikipedias
//               (items.json, "suspect"); asks Wikidata again what is called so (namedItems: lone when the item
//               linked is the only one), then what the AI would choose if that item were refused (the path of
//               several items: describeItems, organizationPrompt with 5 titles). One call every 5 s, waiting
//               as asked on 429. Writes results.json (added to, by mention; review.mjs writes review.txt for
//               a judgement by hand, truth.json). Read-only on the database
//               node --env-file=.env bench/lone-organizations/bench.mjs most|random|suspect [count]
//

import fs from 'node:fs';
import pg from 'pg';
import {describeItems, namedItems} from '../../services/utils/wikidata.js';
import {ollamaJson} from '../../services/utils/ollama.js';
import {organizationPrompt} from '../../services/utils/organization-items.js';

const SAMPLE = process.argv[2];
const COUNT = Number(process.argv[3] ?? 60);
const TITLES = 5;
const PAUSE_MS = 5000;
const FILE = new URL('./results.json', import.meta.url);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const items = JSON.parse(fs.readFileSync(new URL('./items.json', import.meta.url)));
const results = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : [];
const done = new Set(results.map(e => e.id));

// a call to Wikidata, again after the pause it asks for, then a pause
const asked = async (call) => {
    for (;;) {
        try {
            const answer = await call();
            await wait(PAUSE_MS);
            return answer;
        } catch (err) {
            // the connection lost (a timeout, a reset): again after a while
            if (!err.paused && !/fetch failed|timed? ?out|abort/i.test(err.message)) throw err;
            console.log(`  waits ${Math.round((err.retryIn ?? 30e3) / 1000)} s (${err.message})`);
            await wait((err.retryIn ?? 30e3) + 1000);
        }
    }
};

const suspect = Object.values(items).filter(item => !item.missing && (item.p31.includes('Q5') || item.props.includes('P625')
    || item.props.includes('P577') || item.links <= 2)).map(item => item.qid);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`
    SELECT id, name, lang, seen, qid FROM mentions
    WHERE kind = 'organization' AND qid IS NOT NULL AND id <> ALL($1::int[]) AND ($2::text[] IS NULL OR qid = ANY($2::text[]))
    ORDER BY ${SAMPLE === 'most' ? 'seen DESC' : 'random()'} LIMIT $3`, [[...done], SAMPLE === 'suspect' ? suspect : null, COUNT]);
const usage = {calls: 0, input: 0, output: 0};
const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; self-hosted news reader, bench)', Accept: 'application/json'};
// an item items.mjs has not read yet, read as it does
const itemOf = async (qid) => {
    if (items[qid]) return items[qid];
    const params = new URLSearchParams({action: 'wbgetentities', ids: qid, props: 'labels|descriptions|claims|sitelinks', languages: 'en', format: 'json'});
    for (;;) {
        const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: HEADERS}).catch(() => null);
        if (!res || res.status === 429 || res.status >= 500) {
            await wait((Number(res?.headers.get('retry-after')) * 1000 || 30e3) + 1000);
            continue;
        }
        const item = (await res.json()).entities[qid];
        await wait(PAUSE_MS);
        return {qid, label: item.labels?.en?.value ?? null, description: item.descriptions?.en?.value ?? null, links: Object.keys(item.sitelinks ?? {}).length,
            p31: (item.claims?.P31 ?? []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean), props: Object.keys(item.claims ?? {})};
    }
};
for (const [i, row] of rows.entries()) {
    const found = await asked(() => namedItems(row.name, row.lang ?? 'en'));
    const exact = found.filter(item => item.exact).map(item => item.qid);
    const described = found.length === 0 ? [] : await asked(() => describeItems(found.map(item => item.qid)));
    const candidates = described.filter(item => !item.human);
    const titles = (await db.query(`
        SELECT title FROM (
            SELECT DISTINCT ON (a.title) a.title, a.id FROM article_mentions am JOIN articles a ON a.id = am.id_article
            WHERE am.id_mention = $1 AND a.title IS NOT NULL ORDER BY a.title, a.id DESC LIMIT 200
        ) t ORDER BY id DESC LIMIT $2`, [row.id, TITLES])).rows.map(r => r.title);
    const answer = candidates.length && titles.length ? await ollamaJson(organizationPrompt(row.name, titles, candidates), usage) : null;
    const chosen = candidates[Number(answer?.n) - 1] ?? null;
    const item = await itemOf(row.qid);
    results.push({
        id: row.id, name: row.name, lang: row.lang, seen: row.seen, sample: SAMPLE, qid: row.qid,
        lone: exact.length === 1 && exact[0] === row.qid, exact, label: item.label, description: item.description,
        links: item.links, p31: item.p31, props: item.props,
        ai: chosen ? {qid: chosen.qid, label: chosen.label, description: chosen.description, links: chosen.links} : null,
        candidates: candidates.map(c => `${c.qid} ${c.label} (${c.links}): ${c.description}`), titles,
    });
    fs.writeFileSync(FILE, JSON.stringify(results, null, 1));
    console.log(`${i + 1}/${rows.length} ${row.name}: ${results.at(-1).lone ? 'lone' : `${exact.length} exact`}, AI ${chosen?.qid ?? '-'}`);
}
await db.end();

console.log(`${usage.calls} AI calls, ${usage.input} tokens in, ${usage.output} out`);
