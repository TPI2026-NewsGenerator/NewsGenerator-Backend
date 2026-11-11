//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: country-names.js
//  Description: The names of the countries: the country a name of the news is ("Espagne": Spain), and
//               the names of the countries of a card (see countries.js) in the language of the reader, as
//               the e-mail shows them (client countries.js for the page)
//

"use strict"

import {readFileSync} from 'node:fs';
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

// The names of the countries of a card to show (countries: codes, the main first), in 'locale'. All of them, even when its title
// names them (the user, 06.11.2026: the rule of 18.10.2026 that left out a "Zambie" next to "La Zambie limoge..." hid the country of
// "Aruba" and "Cameroun" cards, ticked in the editor and seen nowhere)
export const countryNames = (countries = [], {locale = 'en'} = {}) => countries.map(code => countryName(code, locale));

// Whether a code is the one of a country the e-mail can name: two capital letters, known to Intl (an unknown
// code is its own name), not the European Union or a pseudo-locale
export const isCountry = (code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code) && !NOT_COUNTRIES.has(code) && countryName(code, 'en') !== code;

// the languages the names of countries are known in: the ones of the news, about
const NAMED_IN = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'bs', 'hu', 'ro', 'bg', 'el',
    'ru', 'uk', 'tr', 'sv', 'da', 'nb', 'fi', 'et', 'lv', 'lt', 'sq', 'ar', 'he', 'ja', 'zh', 'ko', 'vi', 'id', 'ms',
    // the languages of the news that had none (Azerbaijani 390 places met, Macedonian 211, Uzbek 212, Catalan 158, Armenian 78...):
    // none of the names of the languages above is lost to them (measured, 8.11.2026)
    'az', 'uz', 'kk', 'be', 'mk', 'ca', 'hy', 'ka', 'is', 'eu', 'gl',
    // the languages of the news in other scripts that had none (11.11.2026: "ایران" named by 1 818 news in Urdu, Persian and Pashto, "امریکا" 1 491,
    // and 6 000 more with the names of the countries in these languages, none read: a card of these languages had no country): Intl knows
    // all the 273 countries in each of them and not one of the names is the one of English, so none can meet a word of another language
    'fa', 'ur', 'ps', 'tg', 'ky', 'mn', 'th', 'hi', 'mr', 'ne', 'bn', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'si', 'km', 'lo', 'my', 'am'];
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
// the United Kingdom is Great Britain in the news of many languages (Intl knows it as "United Kingdom" only: "Großbritannien", 497 news,
// left with no country, 8.11.2026)
PARTS.GB.push('Great Britain', 'Britain', 'Großbritannien', 'Grande-Bretagne', 'Gran Bretaña', 'Gran Bretagna', 'Grã-Bretanha', 'Groot-Brittannië',
    'Storbritannien', 'Wielka Brytania', 'Velká Británie', 'Veľká Británia', 'Velika Britanija', 'Marea Britanie');
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

// The code of the country a name is, declined as the languages with cases decline it: "Hiszpanii" (Poland, Spain), "Srbiji", "Deutschlands",
// "Franciaországból", "Казахстане", "Μεξικού", "Almanya'da". The tagger gives these forms as places of their own and Wikidata has no
// item for them: 1 217 of the 76 946 places of the news met 5 times or more, "Srbiji" 4 222 times, and a card of the Polish "Hiszpanii"
// had no country (measured on the database, 8.11.2026). A name is the name of a country, or its first letters when it ends with a
// vowel, with up to 3 letters after: five letters at least, since four read "Leeds" as Lithuania (Leedu), "Perugia" as Peru, "Palace" as
// Palau. Left out: a name of several words or with a hyphen or a figure ("Canada-EU", "India-US"), an adjective of nationality
// ("Australian": see nationalities.js), a name two countries start (null), the "y" of "Norway"/"Germany" taken for a vowel to
// drop ("Norwalk", "Germantown"), and a word of an English news, which has no cases ("Indiana" is the state, not India). Measured on the
// 1 217 forms found: 99 in 100 were a country; the others are a word that starts like one (Liberci, Bolívar, Franchi)
const DECLINED_STEM = 5;
const DECLINED_ENDING = 3;
const FINAL_VOWEL = /[aeiouαεηιουωаеиоуыэюяіє]$/u;
const demonyms = JSON.parse(readFileSync(new URL('./demonyms.json', import.meta.url), 'utf8'));
let declensionStems = null;
const stemsOfCountries = () => {
    if (declensionStems) return declensionStems;
    declensionStems = new Map();
    const add = (stem, code) => {
        if (stem.length >= DECLINED_STEM) declensionStems.set(stem, declensionStems.has(stem) && declensionStems.get(stem) !== code ? null : code);
    };
    for (const [key, code] of namesOfCountries()) {
        if (/[\s\-\d]/.test(key)) continue;
        add(key, code);
        // "hiszpania" is "hiszpanii", "hiszpanię"; "κυπρος" is "κυπρου"
        if (FINAL_VOWEL.test(key) || key.endsWith('ς')) add(key.slice(0, -1), code);
    }
    return declensionStems;
};
export const countryDeclined = (name, language = null) => {
    const key = mentionKey(name);
    if (key.length <= DECLINED_STEM || /[\s\-\d]/.test(key) || namesOfCountries().has(key) || demonyms[key]) return null;
    if (language === 'en' && /^\p{ASCII}+$/u.test(String(name))) return null;
    const stems = stemsOfCountries();
    const found = new Set();
    for (let size = Math.max(DECLINED_STEM, key.length - DECLINED_ENDING); size < key.length; size++) {
        if (stems.has(key.slice(0, size))) found.add(stems.get(key.slice(0, size)));
    }
    return found.size === 1 && !found.has(null) ? [...found][0] : null;
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
