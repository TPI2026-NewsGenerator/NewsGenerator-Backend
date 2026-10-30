// The audit of the three classes the first one left: the locations (the 250 most seen and 250 at random
// seen 10 times or more, whose item is no place: a human, a work, or described as no place), the
// organisations of 2 to 4 letters (acronyms: the 120 most seen, each with the country of its item and the
// countries of the sites naming it), and the persons of one word linked to a human (the 80 most seen).
// Prints each with what Wikidata says, to judge by hand (read only).
// node --env-file=.env bench/link-audit/classes.mjs
import fs from 'node:fs';
import pg from 'pg';
import {describeItems} from '../../services/utils/wikidata.js';
import {countriesOfItems} from '../../services/utils/countries.js';
import {countryOfSite} from '../../services/utils/country-names.js';
import {prisma} from '../../config/db.js';

const patient = async (call) => {
    for (let tries = 0; ; tries++) {
        try { return await call(); } catch (err) {
            if (!err.paused || tries > 20) throw err;
            await new Promise(resolve => setTimeout(resolve, (err.retryIn ?? 65000) + 1000));
        }
    }
};
const describe = async (qids) => {
    const items = new Map();
    const asked = [...new Set(qids)];
    for (let i = 0; i < asked.length; i += 10) {
        for (const item of await patient(() => describeItems(asked.slice(i, i + 10)))) items.set(item.qid, item);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return items;
};
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();

// 1. locations
const top = (await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE kind = 'location' AND qid IS NOT NULL ORDER BY seen DESC LIMIT 250`)).rows;
const random = (await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE kind = 'location' AND qid IS NOT NULL AND seen >= 10 ORDER BY random() LIMIT 250`)).rows;
const places = [...top, ...random.filter(row => !top.some(t => t.id === row.id))];
const placeItems = await describe(places.map(row => row.qid));
const PLACE_WORDS = /country|sovereign|state|republic|kingdom|territory|region|province|city|town|village|capital|island|continent|municipality|commune|county|district|area|borough|neighbo|prefecture|canton|peninsula|desert|river|mountain|lake|sea\b|ocean|bay|strait|airport|port\b|settlement|urban|metropolitan|parish|archipelago|enclave|department|oblast|governorate|emirate/i;
console.log(`== LOCATIONS: ${places.length} linked (250 most seen, ${places.length - top.length} more at random)`);
const oddPlaces = places.filter(row => {
    const item = placeItems.get(row.qid);
    return item && (item.human || item.work || !(item.place || PLACE_WORDS.test(item.description)));
});
console.log(`${oddPlaces.length} whose item is a human, a work or not described as a place`);
for (const row of oddPlaces) {
    const item = placeItems.get(row.qid);
    console.log(`${row.seen}\t${row.name} [${row.lang}] -> ${item.label} (${item.description}) ${item.links} wikis${item.human ? ' HUMAN' : ''}${item.work ? ' WORK' : ''}`);
}

// 2. acronyms
const acronyms = (await db.query(`SELECT id, name, lang, qid, seen FROM mentions WHERE kind = 'organization' AND qid IS NOT NULL
    AND name ~ '^[A-Za-zÀ-ÿ0-9.&]{2,4}$' AND upper(name) = name ORDER BY seen DESC LIMIT 120`)).rows;
const acronymItems = await describe(acronyms.map(row => row.qid));
const countries = await countriesOfItems(acronyms.map(row => row.qid), {background: true});
console.log(`\n== ACRONYMS: ${acronyms.length} organisations of 2 to 4 capitals linked, the most seen`);
for (const row of acronyms) {
    const item = acronymItems.get(row.qid);
    const {rows: sites} = await db.query(`SELECT regexp_replace(lower(split_part(a.link, '/', 3)), '^www\.', '') AS site, count(*)::int AS news
        FROM article_mentions am JOIN articles a ON a.id = am.id_article WHERE am.id_mention = $1 GROUP BY 1`, [row.id]);
    const by = {};
    for (const s of sites) { const c = countryOfSite(s.site); if (c) by[c] = (by[c] ?? 0) + s.news; }
    const top3 = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}${n}`).join(' ');
    console.log(`${row.seen}\t${row.name} [${row.lang}] -> ${item?.label} (${(item?.description ?? '').slice(0, 70)}) ${item?.links} wikis, item ${countries.get(row.qid)?.country ?? '-'}, sites ${top3}`);
}
await db.end();

// 3. persons of one word linked to a human (read by bench/link-types/relink.mjs)
const items = JSON.parse(fs.readFileSync(new URL('../link-types/items.json', import.meta.url), 'utf8'));
const db2 = new pg.Client({connectionString: process.env.DATABASE_URL});
await db2.connect();
const singles = (await db2.query(`SELECT name, qid, seen FROM mentions WHERE kind = 'person' AND qid IS NOT NULL AND key NOT LIKE '% %' ORDER BY seen DESC`)).rows
    .filter(row => items[row.qid]?.human).slice(0, 80);
await db2.end();
console.log(`\n== SINGLE WORDS linked to a human: the ${singles.length} most seen`);
for (const row of singles) console.log(`${row.seen}\t${row.name} -> ${items[row.qid].label} (${items[row.qid].description}) ${items[row.qid].links} wikis`);
await prisma.$disconnect();
