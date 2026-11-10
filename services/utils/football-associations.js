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

const TABLE = JSON.parse(readFileSync(new URL('./football-associations.json', import.meta.url), 'utf8'));

// the codes of a country the filter takes: "JP", "GB", "GB-WLS"
export const COUNTRY_CODE = /^[A-Z]{2}(-[A-Z]{3})?$/;

// the associations of a country, [{qid, name, country}], none for a code that has none. "GB" gives the four nations too
export const associationsOfCountry = (code) => TABLE.filter(item => item.level === 'association' && item.country !== null
    && (item.country === code || item.country.startsWith(`${code}-`)));

export const associationNames = () => new Map(TABLE.map(item => [item.qid, item.name]));
