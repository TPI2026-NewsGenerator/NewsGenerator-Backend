//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: football-associations.js
//  Description: The football associations of FIFA as items of Wikidata with the code of their country (the table is made by
//               scripts/build-football-associations.js): the filter "country" of /api/v1/news is the items of Wikidata
//               their news name. A code of two letters is a country or a territory ("JP", "BM"), "GB" is also the four
//               nations of the United Kingdom, each with its own code of ISO 3166-2 ("GB-WLS")
//

"use strict"

import {readFileSync} from 'node:fs';
import {countryNamed} from './country-names.js';
import {nationalityOf} from './nationalities.js';

const TABLE = JSON.parse(readFileSync(new URL('./football-associations.json', import.meta.url), 'utf8'));

// the codes of a country the filter takes: "JP", "GB", "GB-WLS"
export const COUNTRY_CODE = /^[A-Z]{2}(-[A-Z]{3})?$/;

// the associations of a country, [{qid, name, country}], none for a code that has none. "GB" gives the four nations too
export const associationsOfCountry = (code) => TABLE.filter(item => item.level === 'association' && item.country !== null
    && (item.country === code || item.country.startsWith(`${code}-`)));

export const associationNames = () => new Map(TABLE.map(item => [item.qid, item.name]));

// The name of an association the press writes with the name of its country: "Japan FA", "Portugal's soccer federation", "U.S. Soccer
// federation", "Portuguese football federation". Wikidata calls them by their own name ("Japan Football Association", "Portuguese
// Football Federation"), so the tagger found these names and the link left them with no item: 494 of the 1 661 mentions of the names of
// this shape in the database were, "Japan FA" 85 times, "Portugal FA" 101, and the friend's route by country missed their news (measured
// 11.11.2026, bench/federations/country-fa.mjs). Only "FA" and the football bodies, not "FF" (the Swedish clubs: Kalmar FF) nor a cup
// ("Jordan FA Cup"): the name ends with the body
const BODY = /^(.+?)(?:['’]s)? (?:FA|football association|football federation|soccer federation|soccer association)$/i;

// The country's name alone says which association is meant when the country has one in the table. Left out:
//  - Ireland: the "Irish FA" of the English press is the association of Northern Ireland, the Republic has the FAI (625 news of the
//    first, 421 of "Irish Football Association" linked to Northern Ireland): no way to choose
//  - the United Kingdom: four associations (associationsOfCountry gives them all); the Wikidata search finds those by their own names
//  - the two Congos: the press writes "Congo" for the one and the other
// And the adjective ("Portuguese FA", "Spanish football federation") is read for any country but the ones whose own football is another
// sport: "American football federation" is gridiron, "Australian football association" the Australian rules, "Canadian" the Canadian
const DOUBTFUL = new Set(['IE', 'CG', 'CD']);
const FOOTBALL_IS_ANOTHER_SPORT = new Set(['US', 'CA', 'AU']);

// the item of the association a name says, null when it says none or can't tell between several
export const associationNamed = (name) => {
    // the headline of a news agency starts with its sport ("Soccer-Japan FA says..."), the tagger keeps it in the name
    const found = BODY.exec(String(name ?? '').trim().replace(/^(?:soccer|football)-/i, ''));
    if (!found) return null;
    const country = countryNamed(found[1]);
    // an adjective of nationality is one word ("Swiss", "Portuguese"): two words, or a hyphen, are a club or a body of its own
    const code = country ?? (/^[^\s-]+$/.test(found[1]) ? nationalityOf(found[1]) : null);
    if (!code || DOUBTFUL.has(code) || (!country && FOOTBALL_IS_ANOTHER_SPORT.has(code))) return null;
    const associations = associationsOfCountry(code);
    return associations.length === 1 ? associations[0].qid : null;
};
