//
//  Author: Fabian Rostello
//  Date: 08.11.2026
//  File: nationalities.js
//  Description: The country the name of an organisation says by its words, for a card whose names give none: "Eesti jalgpalliliit" (the
//               Estonian federation, unlinked, a compound with a small last letter: the card showed no country, the unsaved briefing of
//               Enzo of 8.11.2026), "Argentina FA", "Fédération Algérienne de Football", "التحكيم الأردني" (Jordanian refereeing).
//               Measured on the 590 cards of the last 40 briefings, 185 of them without a country: a name that starts with a country
//               added 4 countries, all right; an adjective of nationality (data/demonyms of Wikidata, see scripts/build-demonyms.js)
//               added 14, 12 right (a federation of another country named in passing, a doubtful one), and agreed with the 62 cards
//               that had the country already. The two read only organisations (a person: "Jordan Henderson"; a place has its item),
//               and a word of four letters at least ("AS Roma" was the American Samoa, "JK Tallinna" a code)
//

"use strict"

import {readFileSync} from 'node:fs';
import {countryNamed} from './country-names.js';
import {mentionKey} from './mentions.js';

// key (see mentionKey) -> code ISO 3166-1 of the adjectives of nationality that one country has
const demonyms = JSON.parse(readFileSync(new URL('./demonyms.json', import.meta.url), 'utf8'));
const MIN_LETTERS = 4;
const letters = (word) => [...word].length;

// the code of the country an organisation's name starts with (one, two or three words: "United States Soccer Federation"), or has an
// adjective of nationality of (any of its words, the article of Arabic aside); null for any other name, a person or a place, or a name
// that is a country (those are named as such, see countryNamed)
export const nationalityOf = (name, kind = 'organization') => {
    if (kind !== 'organization' || countryNamed(name)) return null;
    const words = mentionKey(name).split(/[\s\-']+/).filter(Boolean);
    for (let size = Math.min(3, words.length - 1); size >= 1; size--) {
        const first = words.slice(0, size).join(' ');
        const code = letters(first) >= MIN_LETTERS ? countryNamed(first) : null;
        if (code) return code;
    }
    for (const word of words) {
        const code = demonyms[word.replace(/^ال/, '')];
        if (code && letters(word.replace(/^ال/, '')) >= MIN_LETTERS) return code;
    }
    return null;
};
