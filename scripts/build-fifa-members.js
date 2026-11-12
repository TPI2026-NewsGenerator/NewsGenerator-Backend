//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: build-fifa-members.js
//  Description: The 211 member associations of FIFA and the 6 confederations, written to services/utils/fifa-members.json: what the map
//               "The FIFA presidency" is made of (one row per member: its code of FIFA, its confederation, the code of its country,
//               where to draw its marker). The list and the codes are the ones of FIFA ("FIFA member codes" of Wikipedia: Wikidata
//               has the code of FIFA (P3441) on the wrong items, 5 associations share one with another, and some members of
//               CONCACAF that FIFA does not count have one), the federation of each member is the one of
//               football-associations.js (scripts/build-football-associations.js), its confederation and its coordinates come from
//               Wikidata. Stops with an error, writing nothing, if the list is not 211 members each with one federation and one
//               confederation
//
//  node scripts/build-fifa-members.js
//

import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {wikimediaHeaders} from '../services/utils/wikidata.js';
import {countryNamed} from '../services/utils/country-names.js';

const LIST = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_FIFA_country_codes&prop=text&section=1&format=json&formatversion=2';
const EXPECTED = 211;

const CONFEDERATIONS = [
    {qid: 'Q83276', fifa: 'AFC', name: 'Asian Football Confederation'},
    {qid: 'Q168360', fifa: 'CAF', name: 'Confederation of African Football'},
    {qid: 'Q160549', fifa: 'CONCACAF', name: 'Confederation of North, Central America and Caribbean Association Football'},
    {qid: 'Q58733', fifa: 'CONMEBOL', name: 'South American Football Confederation'},
    {qid: 'Q180344', fifa: 'OFC', name: 'Oceania Football Confederation'},
    {qid: 'Q35572', fifa: 'UEFA', name: 'Union of European Football Associations'},
];

// The name of a member FIFA writes in its own way, which country-names.js does not know, as the code of its country (ISO 3166-1, ISO 3166-2
// for the four nations of the United Kingdom, the codes football-associations.json has). Checked by hand 12.11.2026: these are the 18 of
// the 211 names that countryNamed does not turn into the code of a federation of the table
const ISO_OF = {
    ATG: 'AG', BIH: 'BA', TPE: 'TW', CZE: 'CZ', COD: 'CD', ENG: 'GB-ENG', GRE: 'GR', CIV: 'CI', NIR: 'GB-NIR', IRL: 'IE', SKN: 'KN',
    VIN: 'VC', STP: 'ST', SCO: 'GB-SCT', TAH: 'PF', TRI: 'TT', TCA: 'TC', WAL: 'GB-WLS',
};
// Wikidata gives no confederation to the federation of Tunisia (12.11.2026)
const CONFEDERATION_OF = {TUN: 'CAF'};
// the item of the nation, for the four that have no code of ISO 3166-1 of their own
const NATION_ITEM = {'GB-ENG': 'Q21', 'GB-SCT': 'Q22', 'GB-WLS': 'Q25', 'GB-NIR': 'Q26'};

const sparql = async (query) => {
    const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {headers: wikimediaHeaders()});
    if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
    return (await response.json()).results.bindings;
};
const qidOf = (value) => value.value.split('/').pop();
const problems = [];

// 1. the 211 members of FIFA, in the words of FIFA
const page = await fetch(LIST, {headers: wikimediaHeaders()});
if (!page.ok) throw new Error(`Wikipedia: HTTP ${page.status}`);
const html = (await page.json()).parse.text;
const listed = [...html.matchAll(/<tr>\s*<td>(.*?)<\/td>\s*<td>\s*([A-Z]{3})\s*<\/td>\s*<\/tr>/gs)]
    .map(match => ({country: match[1].replace(/<[^>]+>/g, '').replace(/&#160;|&nbsp;/g, ' ').trim(), fifa: match[2]}));
if (listed.length !== EXPECTED) problems.push(`the list of Wikipedia has ${listed.length} members, FIFA has ${EXPECTED}`);
if (new Set(listed.map(item => item.fifa)).size !== listed.length) problems.push('a code of FIFA is listed twice');

// 2. the federation of each: the association of the table that has the code of its country
const table = JSON.parse(readFileSync(new URL('../services/utils/football-associations.json', import.meta.url), 'utf8'));
const byIso = Object.groupBy(table.filter(item => item.level === 'association' && item.country), item => item.country);
const members = [];
for (const {country, fifa} of listed) {
    const iso = ISO_OF[fifa] ?? countryNamed(country);
    const found = iso ? byIso[iso] ?? [] : [];
    if (found.length !== 1) {
        problems.push(`${fifa} ${country}: ${iso ? `${found.length} associations with the code ${iso}` : 'no code of country'}`);
        continue;
    }
    members.push({qid: found[0].qid, fifa, country, association: found[0].name, iso, ...(found[0].acronyms ? {acronyms: found[0].acronyms} : {})});
}

// 3. the confederation of each (a membership with no end), and where to draw it
const confederationOf = new Map();
for (let at = 0; at < members.length; at += 120) {
    const batch = members.slice(at, at + 120);
    const rows = await sparql(`
SELECT ?fa ?conf WHERE {
  VALUES ?fa { ${batch.map(item => `wd:${item.qid}`).join(' ')} }
  VALUES ?conf { ${CONFEDERATIONS.map(item => `wd:${item.qid}`).join(' ')} }
  ?fa p:P463 ?membership . ?membership ps:P463 ?conf .
  FILTER NOT EXISTS { ?membership pq:P582 ?end }
}`);
    for (const row of rows) {
        const found = confederationOf.get(qidOf(row.fa)) ?? new Set();
        found.add(CONFEDERATIONS.find(item => item.qid === qidOf(row.conf)).fifa);
        confederationOf.set(qidOf(row.fa), found);
    }
}
for (const member of members) {
    const found = [...(confederationOf.get(member.qid) ?? [])];
    const chosen = CONFEDERATION_OF[member.fifa] ?? (found.length === 1 ? found[0] : null);
    if (!chosen) problems.push(`${member.fifa} ${member.country}: ${found.length === 0 ? 'no confederation in Wikidata' : `several confederations (${found.join(', ')})`}`);
    member.confederation = chosen;
}

const place = new Map();
const point = (value) => {
    const [lng, lat] = value.match(/Point\(([-\d.e]+) ([-\d.e]+)\)/).slice(1).map(Number);
    return {lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000};
};
const plain = [...new Set(members.map(item => item.iso).filter(iso => !NATION_ITEM[iso]))];
for (const row of await sparql(`
SELECT ?iso ?coord WHERE {
  VALUES ?iso { ${plain.map(iso => `"${iso}"`).join(' ')} }
  ?c wdt:P297 ?iso ; wdt:P625 ?coord .
  FILTER NOT EXISTS { ?c wdt:P576 ?dissolved }
}`)) if (!place.has(row.iso.value)) place.set(row.iso.value, point(row.coord.value));
for (const row of await sparql(`SELECT ?c ?coord WHERE { VALUES ?c { ${Object.values(NATION_ITEM).map(qid => `wd:${qid}`).join(' ')} } ?c wdt:P625 ?coord }`)) {
    place.set(Object.keys(NATION_ITEM).find(iso => NATION_ITEM[iso] === qidOf(row.c)), point(row.coord.value));
}
for (const member of members) {
    const where = place.get(member.iso);
    if (!where) problems.push(`${member.fifa} ${member.country}: no coordinates for ${member.iso}`);
    else Object.assign(member, where);
}

if (members.length !== EXPECTED && problems.length === 0) problems.push(`${members.length} members written, FIFA has ${EXPECTED}`);
if (problems.length > 0) {
    console.error(`Nothing written, ${problems.length} problem(s):\n${problems.map(line => ` - ${line}`).join('\n')}`);
    process.exit(1);
}

members.sort((a, b) => a.country.localeCompare(b.country));
const file = {
    about: 'The 211 member associations of FIFA and its 6 confederations, made by scripts/build-fifa-members.js: do not edit by hand',
    confederations: CONFEDERATIONS.map(item => ({...item, level: 'confederation'})),
    members: members.map(member => ({...member, level: 'association'})),
};
writeFileSync(new URL('../services/utils/fifa-members.json', import.meta.url), `${JSON.stringify(file, null, 1)}\n`);
const counts = Object.entries(Object.groupBy(members, item => item.confederation)).map(([code, items]) => `${code} ${items.length}`).join(', ');
console.log(`${members.length} members (${counts}), ${new Set(members.map(item => item.iso)).size} codes of country`);
