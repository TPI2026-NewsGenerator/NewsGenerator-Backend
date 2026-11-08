// The places of the news that are the name of a country declined ("Hiszpanii", "Srbiji", see countryDeclined of country-names.js): all the
// places met 5 times or more, those found, unlinked first, the most met first, to judge by hand. 8.11.2026: 1 217 of 76 946 unlinked, 99 in
// 100 a country (Liberci, Bolívar, Franchi were not). Writes bench/data/declined-hits.json, nothing in the database
//   node --env-file=.env bench/declined-countries.mjs [shown=120]
import process from 'node:process';
import {mkdirSync, writeFileSync} from 'node:fs';
import pg from 'pg';
import {countryDeclined, countryNamed} from '../services/utils/country-names.js';

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query("SELECT name, lang, qid, seen FROM mentions WHERE kind = 'location' AND seen >= 5");
await c.end();
const hits = rows.filter(row => !countryNamed(row.name)).map(row => ({...row, code: countryDeclined(row.name, row.lang)})).filter(row => row.code)
    .sort((a, b) => Boolean(a.qid) - Boolean(b.qid) || b.seen - a.seen);
mkdirSync('bench/data', {recursive: true});
writeFileSync('bench/data/declined-hits.json', JSON.stringify(hits));
console.log(`${rows.length} places, ${hits.length} declined country names found, ${hits.filter(row => !row.qid).length} with no item`);
console.log(hits.slice(0, Number(process.argv[2] ?? 120)).map(row => `${row.name}|${row.lang}(${row.seen})${row.qid ? '*' : ''}>${row.code}`).join('  '));
process.exit(0);
