//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: country-names.js
//  Description: The names of the countries: the country a name of the news is ("Espagne": Spain), and
//               the names of the countries of a card (see countries.js) in the language of the reader, as
//               the e-mail shows them (client countries.js for the page)
//

"use strict"

import {mentionKey} from './mentions.js';

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

// the languages the names of countries are known in: the ones of the news, about
const NAMED_IN = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'bs', 'hu', 'ro', 'bg', 'el',
    'ru', 'uk', 'tr', 'sv', 'da', 'nb', 'fi', 'et', 'lv', 'lt', 'sq', 'ar', 'he', 'ja', 'zh', 'ko', 'vi', 'id', 'ms'];
// codes that are no country: the European Union, the eurozone, the United Nations, outlying Oceania,
// pseudo-locales, unknown
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
// names no code has: the nations of the United Kingdom, with their own football teams, the old English
// name of Türkiye, and "US" as the news write it (a name of the tagger, never the word "us")
const PARTS = {
    GB: ['England', 'Angleterre', 'Inglaterra', 'Inghilterra', 'Engeland', 'Scotland', 'Écosse', 'Escocia', 'Schottland', 'Scozia',
        'Wales', 'Pays de Galles', 'Gales', 'Galles', 'Northern Ireland', 'Irlande du Nord', 'Nordirland', 'Irlanda del Norte'],
    TR: ['Turkey'],
    US: ['US', 'U.S', 'U.S.', 'U.S.A', 'U.S.A.', 'EE.UU', 'EE.UU.', 'EEUU'],
};
let countryKeys = null;
// Map key (see mentionKey) -> code of the names of every country, long and short ("United Kingdom",
// "UK", "Royaume-Uni", "Vereinigtes Königreich"), in NAMED_IN; a name of two countries left out
const namesOfCountries = () => {
    if (countryKeys) return countryKeys;
    const found = new Map();
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    // an old code is the one of today ("FX" metropolitan France is "FR", "DD" East Germany "DE", "SU" the
    // Soviet Union "RU", "UK" "GB"): its name is the same, not a name of two countries
    const today = (code) => {
        try {
            return new Intl.Locale(`und-${code}`).region ?? code;
        } catch {
            return code;
        }
    };
    const codes = letters.flatMap(a => letters.map(b => a + b)).filter(code => !NOT_COUNTRIES.has(code) && today(code) === code);
    for (const language of NAMED_IN) {
        for (const style of ['long', 'short']) {
            let display;
            try {
                display = new Intl.DisplayNames([language], {type: 'region', style, fallback: 'none'});
            } catch {
                continue;
            }
            for (const code of codes) {
                const name = display.of(code);
                const key = name && name !== code ? mentionKey(name) : '';
                // a word of 3 letters names a country in capitals only ("UK", "USA"): "Man" is the Isle of Man
                if (key.length < 2 || (key.length < 4 && name !== name.toUpperCase())) continue;
                found.set(key, found.has(key) && found.get(key) !== code ? null : code);
            }
        }
    }
    countryKeys = new Map([...found].filter(([, code]) => code));
    for (const [code, parts] of Object.entries(PARTS)) parts.forEach(name => countryKeys.set(mentionKey(name), code));
    return countryKeys;
};

// the article a name of a country may start with ("la France", "the Netherlands", "die Schweiz")
const ARTICLE = /^(la|le|les|l'|the|el|los|las|il|lo|der|die|das)\s*/;

// The code of the country a name is, written so in one of the languages of the news ("Espagne", "la
// France", "España", "Spain": "ES"), null for any other name
export const countryNamed = (name) => {
    const key = mentionKey(name);
    return namesOfCountries().get(key) ?? namesOfCountries().get(key.replace(ARTICLE, '')) ?? null;
};
