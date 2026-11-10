//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: build-football-associations.js
//  Description: The football associations of Wikidata (members of FIFA) with the code of their country, written to
//               services/utils/football-associations.json: what the filter "country" of /api/v1/news turns into
//               the items of Wikidata the news name. One call to Wikidata; run again when the members change
//
//  node scripts/build-football-associations.js
//

import {writeFileSync} from 'node:fs';
import process from 'node:process';
import {wikimediaHeaders} from '../services/utils/wikidata.js';

const FIFA = 'Q253414';
// the confederations are no association of a country: they come apart, level "confederation"
const CONFEDERATION = /^(confederation of african|asian football confederation|union of european|oceania football|conmebol|south american football|concacaf|confederation of north)/i;

const query = `
SELECT ?fa ?faLabel ?iso WHERE {
  ?fa wdt:P463 wd:${FIFA} ; wdt:P31 ?type .
  ?type rdfs:label "association football federation"@en .
  OPTIONAL { ?fa wdt:P17 ?country . ?country wdt:P297 ?iso . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {headers: wikimediaHeaders()});
if (!response.ok) {
    console.error(`Wikidata: HTTP ${response.status}`);
    process.exit(1);
}
const rows = (await response.json()).results.bindings;

const byQid = new Map();
for (const row of rows) {
    const qid = row.fa.value.split('/').pop();
    const item = byQid.get(qid) ?? {qid, name: row.faLabel.value, countries: new Set()};
    if (row.iso) item.countries.add(row.iso.value);
    byQid.set(qid, item);
}
// Wikidata gives the country of the state, not of the territory: the association of Bermuda is of "United Kingdom", the one of Tahiti of
// "France", Hong Kong is of China, and a few have none. FIFA counts each of them, and the four nations of the United Kingdom apart: these
// are given the code of their own (ISO 3166-1 for a territory, ISO 3166-2 for a nation of the United Kingdom, so that "GB" still finds all
// four). Checked by hand on 10.11.2026 against the list of the countries that grouped several associations
const OWN_CODE = {
    'The Football Association': 'GB-ENG', 'Scottish Football Association': 'GB-SCT', 'Football Association of Wales': 'GB-WLS', 'Irish Football Association': 'GB-NIR',
    'Anguilla Football Association': 'AI', 'Bermuda Football Association': 'BM', 'British Virgin Islands Football Association': 'VG',
    'Cayman Islands Football Association': 'KY', 'Gibraltar Football Association': 'GI', 'Montserrat Football Association': 'MS',
    'Turks and Caicos Islands Football Association': 'TC', 'Football Committee of Saint Martin': 'MF', 'Guadeloupean League of Football': 'GP',
    'New Caledonian Football Federation': 'NC', 'Tahitian Football Federation': 'PF', 'Football Federation American Samoa': 'AS',
    'Guam Football Association': 'GU', 'Puerto Rican Football Federation': 'PR', 'U.S. Virgin Islands Soccer Federation': 'VI',
    'Football Association of Hong Kong, China': 'HK', 'Royal Dutch Football Association': 'NL', 'Bonaire Football Federation': 'BQ',
    'Northern Mariana Islands Football Association': 'MP', 'Sint Maarten Soccer Association': 'SX',
};
// a regional body of several countries, no association of one
const LEFT_OUT = new Set(['Association of Football Federations of CIS']);

const list = [...byQid.values()].filter(item => !LEFT_OUT.has(item.name)).map(item => {
    const level = CONFEDERATION.test(item.name) ? 'confederation' : 'association';
    return {
        qid: item.qid,
        name: item.name,
        level,
        country: level === 'confederation' ? null : OWN_CODE[item.name] ?? [...item.countries].sort()[0] ?? null,
    };
}).sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(new URL('../services/utils/football-associations.json', import.meta.url), `${JSON.stringify(list, null, 1)}\n`);
const without = list.filter(item => item.country === null && item.level === 'association');
console.log(`${list.length} items (${list.filter(item => item.level === 'association').length} associations, ${list.filter(item => item.level === 'confederation').length} confederations), ${new Set(list.map(item => item.country).filter(Boolean)).size} country codes; associations without a country: ${without.map(item => item.name).join(', ') || 'none'}`);
const shared = Object.entries(Object.groupBy(list.filter(item => item.country), item => item.country)).filter(([, items]) => items.length > 1);
console.log(`codes shared by several associations: ${shared.map(([code, items]) => `${code}: ${items.map(item => item.name).join(' | ')}`).join('; ') || 'none'}`);
