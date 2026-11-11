//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: acronym-country.mjs
//  Description: The acronyms of national bodies the cards of the saved briefings show, linked to an item of a country other than the one all the
//               sites of their card are of ("FTF" of togofoot.tg linked to the Tunisian federation): how many there are, and what
//               withAcronymsOfSitesCountry (services/utils/name-check.js) makes of each, run RUNS times (the AI is not stable)
//
//  node --env-file=.env bench/acronym-country.mjs
//

import 'dotenv/config';
import process from 'node:process';
import {prisma} from '../config/db.js';
import {countryOfSite} from '../services/utils/country-names.js';
import {withAcronymsOfSitesCountry} from '../services/utils/name-check.js';

const RUNS = Number(process.env.RUNS ?? 2);
const ACRONYM = /^[\p{Lu}][\p{Lu}\p{N}&]{2,6}$/u;
const rows = await prisma.$queryRawUnsafe(`SELECT b.id, i->>'storyId' AS story, i->>'title' AS title, i->'names' AS names, i->'articles' AS articles FROM briefings b, jsonb_array_elements(b.items) i
    WHERE b.status='ready' AND jsonb_array_length(coalesce(i->'names','[]'::jsonb)) > 0`);
const qids = [...new Set(rows.flatMap(row => row.names.filter(name => name.qid && !String(name.qid).startsWith('country:')).map(name => name.qid)))];
const of = new Map((await prisma.$queryRawUnsafe('SELECT qid, country, international FROM item_countries WHERE qid = ANY($1)', qids)).map(row => [row.qid, row]));
const seen = new Set();
const cases = [];
for (const row of rows) {
    const sites = (row.articles ?? []).map(article => article.source);
    const codes = new Set(sites.map(countryOfSite).filter(Boolean));
    for (const name of row.names) {
        const info = of.get(name.qid);
        if (name.kind !== 'organization' || !name.qid || !ACRONYM.test(name.name) || !info?.country || info.international || codes.size !== 1 || codes.has(info.country)) continue;
        const key = `${row.story}|${name.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cases.push({briefing: row.id, name, others: row.names.filter(other => other !== name), card: {storyId: Number(row.story), sites, topic: 'sport',
            titles: [row.title, ...(row.articles ?? []).map(article => article.title)].filter((title, i, all) => title && all.indexOf(title) === i)}});
    }
}
console.log(`${cases.length} acronyms of other countries than their sites (of ${rows.length} cards)`);
for (const {briefing, name, others, card} of cases) {
    const results = [];
    for (let run = 0; run < RUNS; run++) {
        const read = [{storyId: card.storyId, names: [{...name}, ...others.map(other => ({...other}))], places: []}];
        results.push((await withAcronymsOfSitesCountry(read, [card]))[0].names[0].qid);
    }
    console.log(`${briefing} ${name.name} ${name.qid} [${card.sites.join(', ')}] -> ${results.map(qid => qid === name.qid ? 'kept' : qid).join(' | ')} | ${card.titles[0].slice(0, 70)}`);
}
await prisma.$disconnect();
process.exit(0);
