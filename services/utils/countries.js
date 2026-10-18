//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: countries.js
//  Description: The countries a card is of, from who and where its articles name: "Hichilema dismisses
//               his minister" tells nothing to a reader who does not know he is the president of Zambia
//               (an idea of a friend of the user, 18.10.2026). Several when its names are of several
//               (Trump and Xi: the United States and China)
//

"use strict"

import {MentionModel} from '../../models/mention-model.js';
import {readCountries} from './wikidata.js';
import {mentionKey} from './mentions.js';

// the countries shown at most, and how much of the first one's weight another one needs
export const MAX_COUNTRIES = 3;
const SHARE_OF_FIRST = 0.5;

// The codes ISO 3166-1 of the countries of a card ("ZM"), the main first. items: [{qid, weight, person}],
// who and where it names, weight the news of the card naming them; of: Map qid -> {country,
// international}. Each item counts once, with its weight; a country is shown when it weighs half the
// first at least: a card on Trump and Xi is of the United States and China, a card on Hichilema in Lusaka
// of Zambia only. A card naming an international body is not of the country of its people: Infantino of
// FIFA, Motsepe of the CAF are no Swiss nor South African news (their clubs, federations and places count)
export const cardCountries = (items, of) => {
    const weights = new Map();
    for (const {qid, weight, person} of items) {
        if (qid) weights.set(qid, {weight: Math.max(weights.get(qid)?.weight ?? 0, weight), person: Boolean(person)});
    }
    const international = [...weights.keys()].some(qid => of.get(qid)?.international);
    const scores = new Map();
    for (const [qid, {weight, person}] of weights) {
        const code = of.get(qid)?.country;
        if (code && !(person && international)) scores.set(code, (scores.get(code) ?? 0) + weight);
    }
    const ranked = [...scores].sort((a, b) => b[1] - a[1]);
    return ranked.filter(([, score]) => score >= ranked[0][1] * SHARE_OF_FIRST).slice(0, MAX_COUNTRIES).map(([code]) => code);
};

// the languages the names of countries are known in: the ones of the news, about
const NAMED_IN = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hr', 'sr', 'bs', 'hu', 'ro', 'bg', 'el',
    'ru', 'uk', 'tr', 'sv', 'da', 'nb', 'fi', 'et', 'lv', 'lt', 'sq', 'ar', 'he', 'ja', 'zh', 'ko', 'vi', 'id', 'ms'];
// codes that are no country: the European Union, the eurozone, the United Nations, outlying Oceania,
// pseudo-locales, unknown
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);
// names no code has: the nations of the United Kingdom, with their own football teams, and the old
// English name of Türkiye
const PARTS = {
    GB: ['England', 'Angleterre', 'Inglaterra', 'Inghilterra', 'Engeland', 'Scotland', 'Écosse', 'Escocia', 'Schottland', 'Scozia',
        'Wales', 'Pays de Galles', 'Gales', 'Galles', 'Northern Ireland', 'Irlande du Nord', 'Nordirland', 'Irlanda del Norte'],
    TR: ['Turkey'],
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
            let names;
            try {
                names = new Intl.DisplayNames([language], {type: 'region', style, fallback: 'none'});
            } catch {
                continue;
            }
            for (const code of codes) {
                const name = names.of(code);
                const key = name && name !== code ? mentionKey(name) : '';
                // a word of 3 letters names a country in capitals only ("UK", "USA"): "Man" is the Isle of Man
                if (key.length < 2 || (key.length < 4 && name !== name.toUpperCase())) continue;
                found.set(key, found.has(key) && found.get(key) !== code ? null : code);
            }
        }
    }
    countryKeys = new Map([...found].filter(([, code]) => code));
    for (const [code, names] of Object.entries(PARTS)) names.forEach(name => countryKeys.set(mentionKey(name), code));
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

// the items asked for to Wikidata at once, kept before the next ones; and how long a card waits for
// Wikidata to answer again: the server linking names shares its address and is refused at times
// (18.10.2026), and the AI writing the cards takes longer anyway
const ITEMS_AT_ONCE = 40;
const MAX_WAIT_MS = 30e3;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Map qid -> {country, international} of these items (see readCountries): the ones read before from the database, the others from
// Wikidata now, kept. Wikidata refusing for longer, or failing: the ones read so far only. background:
// read ahead, no reader waiting (see wikidata.js MAX_LAG_S)
export const countriesOfItems = async (qids, {background = false} = {}) => {
    const asked = [...new Set(qids.filter(Boolean))];
    const known = new Map((await MentionModel.countriesOf(asked)).map(row => [row.qid, {country: row.country, international: row.international}]));
    const missing = asked.filter(qid => !known.has(qid));
    let waited = 0;
    for (let i = 0; i < missing.length;) {
        const part = missing.slice(i, i + ITEMS_AT_ONCE);
        try {
            const read = await readCountries(part, {background});
            await MentionModel.saveCountries([...read].map(([qid, country]) => ({qid, ...country})));
            read.forEach((country, qid) => known.set(qid, country));
            i += ITEMS_AT_ONCE;
        } catch (err) {
            if (err.paused && waited + err.retryIn <= MAX_WAIT_MS) {
                waited += err.retryIn + 1000;
                await wait(err.retryIn + 1000);
                continue;
            }
            console.error(`Countries: ${missing.length - i} items not read from Wikidata (${err.message})`);
            break;
        }
    }
    return known;
};
