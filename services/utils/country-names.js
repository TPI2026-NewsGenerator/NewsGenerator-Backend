//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: country-names.js
//  Description: The names of the countries of a card (see countries.js), in the language of the reader,
//               as the e-mail shows them (client countries.js for the page)
//

"use strict"

const names = new Map();
// the name of a country in a language: countryName('ZM', 'fr') is "Zambie". The code itself when it
// names none
export const countryName = (code, locale = 'en') => {
    try {
        if (!names.has(locale)) names.set(locale, new Intl.DisplayNames([locale], {type: 'region', fallback: 'code'}));
        return names.get(locale).of(code);
    } catch {
        return code;
    }
};

// a text in small letters, without accents, its words between spaces
const plain = (text) => ` ${String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;

// The names of the countries of a card to show (countries: codes, the main first), in 'locale'; none
// when its titles name every one of them already, in one of 'languages' (a word starting so counts:
// "zambien" names Zambia): a "Zambie" next to "La Zambie limoge..." says nothing more
export const countryNames = (countries = [], {titles = [], languages = [], locale = 'en'} = {}) => {
    if (countries.length === 0) return [];
    const written = titles.filter(Boolean).map(plain);
    const tongues = [...new Set([locale, ...languages, 'en'].filter(Boolean))];
    const named = (code) => tongues.some(language => {
        const name = plain(countryName(code, language)).trimEnd();
        return name.trim().length > 0 && written.some(title => title.includes(name));
    });
    return countries.every(named) ? [] : countries.map(code => countryName(code, locale));
};
