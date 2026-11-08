//
//  Author: Fabian Rostello
//  Date: 08.11.2026
//  File: build-demonyms.js
//  Description: The adjectives of nationality of every country, in the languages of Wikidata ("jordanien", "الأردني", "Eesti"...), written
//               to services/utils/demonyms.json: key (see mentionKey) -> code ISO 3166-1. One query to the SPARQL service of Wikidata
//               (P1549, the demonym of an item with a code P297). A word of four letters at least, one word, that one country has:
//               "indian" of India, not a word two countries share. Read by nationalities.js. Run again when the list should grow
//
//  node scripts/build-demonyms.js
//

import {writeFileSync} from 'node:fs';
import process from 'node:process';
import {mentionKey} from '../services/utils/mentions.js';

const QUERY = 'SELECT ?code ?dem WHERE { ?c wdt:P297 ?code . ?c wdt:P1549 ?dem . }';
const MIN_LETTERS = 4;

const answer = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({query: QUERY})}`, {
    headers: {'user-agent': 'NewsGenerator/1.0 (student project; demonyms of the countries)', accept: 'application/sparql-results+json'},
});
if (!answer.ok) {
    console.error(`Wikidata answered ${answer.status}.`);
    process.exit(1);
}
const rows = (await answer.json()).results.bindings;

// key -> the codes that have it; the article of Arabic ("al-") is no part of the word
const codesOf = new Map();
for (const {code, dem} of rows) {
    const key = mentionKey(dem.value).replace(/^ال/, '');
    if ([...key].length < MIN_LETTERS || /\s/.test(key)) continue;
    codesOf.set(key, new Set([...(codesOf.get(key) ?? []), code.value]));
}
// words two items share only because one of them is a territory or a country that is no more ("french" of France and of the French
// Southern Territories, "deutsche" of Germany and of East Germany), or because Wikidata has no word for the one the news use (the
// adjective of the United Kingdom is "British", the news also say "English", "Scottish", "Welsh"): the country the news mean
const OVERRIDES = {french: 'FR', british: 'GB', english: 'GB', scottish: 'GB', welsh: 'GB', britannique: 'GB', deutsche: 'DE', deutscher: 'DE'};
const unique = [...codesOf].filter(([key, codes]) => codes.size === 1 && !OVERRIDES[key]).map(([key, codes]) => [key, [...codes][0]])
    .concat(Object.entries(OVERRIDES)).sort(([a], [b]) => a.localeCompare(b));
writeFileSync(new URL('../services/utils/demonyms.json', import.meta.url), `${JSON.stringify(Object.fromEntries(unique))}\n`);
console.log(`${rows.length} demonyms of ${new Set(rows.map(row => row.code.value)).size} countries: ${unique.length} words kept, ${codesOf.size - unique.length} left out (shared by several countries)`);
console.log(`shared: ${[...codesOf].filter(([, codes]) => codes.size > 1).map(([key, codes]) => `${key}:${[...codes].join('/')}`).join('  ')}`);
