//
//  Author: Fabian Rostello
//  Date: 19.10.2026
//  File: bench.mjs
//  Description: Measure of a rule telling a person apart from their namesakes of Wikidata by the
//               country of the media naming them ("Istvan Kovacs" in prosport.ro is the Romanian
//               referee, not the Hungarian boxer), against famousHuman alone. Reads the persons never
//               linked, the most met first, writes results.json for a judgement by hand
//               node bench/homonyms/bench.mjs [count of each | --names=A,B]
//

import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {exactItems, readCountries} from '../../services/utils/wikidata.js';

const NAMES = process.argv[2]?.startsWith('--names=') ? process.argv[2].slice('--names='.length).split(',') : null;
const COUNT = NAMES ? 0 : Number(process.argv[2] ?? 60);
const PAUSE_MS = 5000;
const OUT = new URL(NAMES ? './results-named.json' : './results.json', import.meta.url);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// a call to Wikidata, again after the pause it asks for
const politely = async (call) => {
    for (;;) {
        try {
            const answer = await call();
            await wait(PAUSE_MS);
            return answer;
        } catch (err) {
            if (!err.paused) throw err;
            await wait((err.retryIn ?? 30e3) + 1000);
        }
    }
};

const HEADERS = {'User-Agent': 'NewsGenerator/1.0 (https://news.fabianrostello.com; self-hosted news reader, bench)', Accept: 'application/json'};
const describe = async (qids) => {
    const params = new URLSearchParams({action: 'wbgetentities', ids: qids.join('|'), props: 'claims|sitelinks|descriptions', languages: 'en', format: 'json'});
    const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {headers: HEADERS});
    if (res.status === 429) throw Object.assign(new Error('429'), {paused: true, retryIn: Number(res.headers.get('retry-after')) * 1000 || 30e3});
    const entities = (await res.json()).entities ?? {};
    return qids.map(qid => entities[qid]).filter(item => item && item.missing === undefined).map(item => ({
        qid: item.id,
        description: item.descriptions?.en?.value ?? null,
        links: Object.keys(item.sitelinks ?? {}).length,
        human: (item.claims?.P31 ?? []).some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5'),
    }));
};

// the country of a site by its domain: "prosport.ro" is Romanian; the generic ones none
const GENERIC = new Set(['co', 'io', 'tv', 'me', 'ai', 'fm', 'ly', 'gg', 'to', 'cc', 'ws', 'la', 'eu', 'su', 'am', 'nu', 'is']);
const countryOfLink = (link) => {
    try {
        const tld = new URL(link).hostname.split('.').at(-1);
        if (tld === 'uk') return 'GB';
        return tld.length === 2 && !GENERIC.has(tld) ? tld.toUpperCase() : null;
    } catch {
        return null;
    }
};
// the languages spoken in one country mostly
const LANGUAGE_COUNTRY = {ro: 'RO', hu: 'HU', pl: 'PL', cs: 'CZ', sk: 'SK', sl: 'SI', hr: 'HR', bg: 'BG', el: 'GR', it: 'IT',
    sv: 'SE', da: 'DK', nb: 'NO', fi: 'FI', et: 'EE', lv: 'LV', lt: 'LT', ja: 'JP', ko: 'KR', tr: 'TR', uk: 'UA'};

// the famous one of these humans: in min Wikipedias at least, ahead times the next one
const famous = (humans, {min = 30, ahead = 3} = {}) => {
    const [first, second] = [...humans].sort((a, b) => b.links - a.links);
    return first && first.links >= min && first.links >= ahead * (second?.links ?? 0) ? first.qid : null;
};

const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
// the most met, then as many met by 5 to 200 news, at random: the local ones ("Istvan Kovacs", 26 news)
const {rows} = await db.query(`
    WITH named AS (
        SELECT m.id, m.name, m.lang, count(*)::int AS news,
               array_agg(a.link ORDER BY a.id DESC) AS links, (array_agg(a.title ORDER BY a.id DESC))[1:3] AS titles
        FROM mentions m JOIN article_mentions am ON am.id_mention = m.id JOIN articles a ON a.id = am.id_article
        WHERE m.kind = 'person' AND m.name LIKE '% %' AND ((m.qid IS NULL AND m.linked_at IS NOT NULL) OR m.name = ANY($2::text[]))
        GROUP BY m.id
    ), most AS (SELECT * FROM named ORDER BY news DESC LIMIT $1)
    SELECT * FROM most
    UNION ALL (SELECT * FROM named WHERE news BETWEEN 5 AND 200 AND id NOT IN (SELECT id FROM most) ORDER BY random() LIMIT $1)
    UNION ALL (SELECT * FROM named WHERE name = ANY($2::text[]))`, [COUNT, NAMES ?? []]);
await db.end();

const results = [];
for (const [i, row] of rows.entries()) {
    const qids = await politely(() => exactItems(row.name, row.lang ?? 'en'));
    const entry = {name: row.name, lang: row.lang, news: row.news, titles: row.titles, found: qids.length};
    // the media's country: the one of most of the sites naming them, when half of them have one
    const byCountry = new Map();
    row.links.map(countryOfLink).filter(Boolean).forEach(code => byCountry.set(code, (byCountry.get(code) ?? 0) + 1));
    const [top] = [...byCountry].sort((a, b) => b[1] - a[1]);
    entry.mediaCountry = top && top[1] * 2 >= row.links.length ? top[0] : null;
    entry.byCountry = Object.fromEntries(byCountry);
    entry.links = row.links.length;
    entry.languageCountry = LANGUAGE_COUNTRY[row.lang] ?? null;
    if (qids.length >= 2) {
        const items = await politely(() => describe(qids));
        const countries = await politely(() => readCountries(qids));
        const humans = items.filter(item => item.human).map(item => ({...item, country: countries.get(item.qid)?.country ?? null}));
        entry.humans = humans;
        const of = (code) => humans.filter(item => code && item.country === code);
        const within = (code, options) => of(code).length === 1 ? of(code)[0].qid : famous(of(code), options);
        const local = entry.mediaCountry ?? entry.languageCountry;
        entry.rules = {
            famous: famous(humans),
            media30: within(entry.mediaCountry, {min: 30}),
            media10: within(entry.mediaCountry, {min: 10}),
            media0: within(entry.mediaCountry, {min: 0}),
            local10: within(local, {min: 10}),
            local0: within(local, {min: 0}),
        };
    }
    results.push(entry);
    console.log(`${i + 1}/${rows.length} ${row.name} (${row.lang}, ${row.news} news): ${qids.length} found, ${JSON.stringify(entry.rules ?? {})}`);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
}
