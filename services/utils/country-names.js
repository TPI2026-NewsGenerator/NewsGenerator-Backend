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

// the domains of two letters that are no country's sites: .co, .io, .tv, .me, .fm are for anyone
const OPEN_DOMAINS = new Set(['co', 'io', 'tv', 'me', 'ai', 'fm', 'ly', 'gg', 'to', 'cc', 'ws', 'la', 'eu', 'su', 'am', 'nu', 'is']);
// The country of a site by its domain: "prosport.ro" is "RO", "bbc.co.uk" "GB"; null for a ".com"
export const countryOfSite = (site) => {
    const domain = String(site ?? '').toLowerCase().replace(/\.$/, '').split('.').at(-1);
    if (domain === 'uk') return 'GB';
    return /^[a-z]{2}$/.test(domain) && !OPEN_DOMAINS.has(domain) ? domain.toUpperCase() : null;
};

// Whether the sites naming a body (sites: [{site, news}], see MentionModel.sitesNaming) say it is not of
// this country: the sites with a country write 20 news of them at least, and one other country writes 70% of
// them ("OL" of French sites is Lyon, not Open Library of the United States; the "Assemblée nationale" of
// French sites is not Senegal's), or none is of this country, unless it is the United States, whose sites
// have no domain of its own ("Primera División" of Spanish-speaking sites is not the Maltese league).
// Measured on 75 organisations linked to the one item called so, judged by hand (bench/org-country,
// 21.10.2026): 9 of the 75 asked to the AI, 3 of the 4 wrong ones, 1 of the country only and 5 right ones;
// the AI said none for the 3 wrong and kept the 5 right
const ELSEWHERE_SHARE = 0.7;
const ELSEWHERE_MIN_NEWS = 20;
export const ofOtherCountry = (sites = [], country = null) => {
    if (!country) return false;
    const byCountry = new Map();
    for (const row of sites) {
        const code = countryOfSite(row.site);
        if (code) byCountry.set(code, (byCountry.get(code) ?? 0) + row.news);
    }
    const total = [...byCountry.values()].reduce((sum, news) => sum + news, 0);
    if (total < ELSEWHERE_MIN_NEWS) return false;
    const [top, news] = [...byCountry].sort((a, b) => b[1] - a[1])[0];
    return (top !== country && news >= ELSEWHERE_SHARE * total) || (country !== 'US' && !byCountry.has(country));
};

// a byline: one site writes this share of the news naming it at least; the country of the media: the one
// of this share of the sites of a country naming it, of MIN_COUNTRY_NEWS of them at least
const BYLINE_SHARE = 0.8;
const COUNTRY_SHARE = 0.5;
const MIN_COUNTRY_NEWS = 3;
// What the sites naming a person tell of them (sites: [{site, news}], see MentionModel.sitesNaming):
// byline, when one site writes most of their news ("Mohammed Ibrahim" 94% of ysscores.com), and country,
// the one of most of the sites of a country naming them ("Istvan Kovacs": prosport.ro, gsp.ro), null when
// none stands out (José Mourinho in 52 countries) (19.10.2026, see wikidata.js famousHuman)
export const mediaOf = (sites = []) => {
    const total = sites.reduce((sum, row) => sum + row.news, 0);
    const byCountry = new Map();
    for (const row of sites) {
        const code = countryOfSite(row.site);
        if (code) byCountry.set(code, (byCountry.get(code) ?? 0) + row.news);
    }
    const inCountries = [...byCountry.values()].reduce((sum, news) => sum + news, 0);
    const [top] = [...byCountry].sort((a, b) => b[1] - a[1]);
    return {
        byline: total > 0 && Math.max(...sites.map(row => row.news)) >= BYLINE_SHARE * total,
        country: top && inCountries >= MIN_COUNTRY_NEWS && top[1] >= COUNTRY_SHARE * inCountries ? top[0] : null,
    };
};
