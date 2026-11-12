//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-attribution.js
//  Description: Whether a passage is about THE association it was linked to, decided by the code and not by the AI: the three models of
//               the measure of 10.11.2026 all read "JFA" of Jordan as the Japan association, and a vote between models does not mend
//               an error all of them make. A name that says its country ("Japan Football Association", "Fédération allemande") is
//               enough; a bare acronym or a generic word ("JFA", "FMF", "NFF", "Federcalcio", "The FA") needs the country in the
//               text, and none of the other countries that write the same letters. When it cannot be shown the passage is not
//               attributed: it is left out, never shown as "uncertain" under the wrong country. Measured on the labels of the
//               gold set (bench/fifa, the field association_ok)
//

"use strict"

import {readFileSync} from 'node:fs';
import {countryNamed} from './country-names.js';
import {mentionKey} from './mentions.js';

const MEMBERS = JSON.parse(readFileSync(new URL('./fifa-members.json', import.meta.url), 'utf8'));
// key (see mentionKey) -> code ISO 3166-1 of the adjectives of nationality of a country ("japonais", "giapponese")
const demonyms = JSON.parse(readFileSync(new URL('./demonyms.json', import.meta.url), 'utf8'));

// The four nations of the United Kingdom are four associations: their own words, since "english" is the "GB" of the demonyms
const NATION_WORDS = {
    'GB-ENG': ['england', 'english', 'inglaterra', 'inglese', 'angleterre', 'anglais', 'englisch', 'engeland'],
    'GB-SCT': ['scotland', 'scottish', 'scots', 'escocia', 'scozia', 'ecosse', 'ecossais', 'schottland', 'schotland'],
    'GB-WLS': ['wales', 'welsh', 'cymru', 'gales', 'galles', 'pays de galles', 'gallois', 'waliser', 'walisisch'],
    'GB-NIR': ['northern ireland', 'northern irish', 'irlanda del norte', 'irlanda del nord', 'irlande du nord', 'nordirland'],
};
// the words that stand for a federation in the news with no country of their own: they say nothing alone
const GENERIC = new Set(['fa', 'the fa', 'football association', 'the football association', 'football federation', 'soccer federation', 'soccer association',
    'federcalcio', 'federation', 'federacion', 'federation de football', 'fedefutbol', 'fif']);
// the confederations whose acronym is also a word or a club ("AFC Ajax", "caf" in a text of French): they need a word of their world
const CONFEDERATION_WORDS = {
    AFC: /\b(asia\w*|asie|asiat\w*|asiatisch\w*|confederation\w*|confederaci\w*|confederazione|konfoderation|konfederasi|salman)\b/u,
    CAF: /\b(afri\w*|confederation\w*|confederaci\w*|confederazione|konfoderation|motsepe|ahmed ahmed)\b/u,
    OFC: /\b(oceani\w*|ocean\w*|ozeani\w*|confederation\w*|confederaci\w*|confederazione|konfoderation)\b/u,
};

// another confederation named in the text: its name or its acronym (UEFA, CONMEBOL, CONCACAF, OFC, AFC, CAF)
const OTHER_CONFEDERATION = /\b(uefa|conmebol|concacaf|ofc|afc|caf)\b/u;

// the acronyms (key) -> the codes of the countries whose association writes them, from the members of FIFA
const OWNERS = new Map();
for (const member of MEMBERS.members) {
    for (const acronym of member.acronyms ?? []) {
        const key = mentionKey(acronym);
        OWNERS.set(key, (OWNERS.get(key) ?? new Set()).add(member.iso));
    }
}

const tokensOf = (text) => String(text ?? '').split(/[^\p{L}\p{N}'’.]+/u).map(token => token.replace(/^['’.]+|['’.]+$/g, '')).filter(Boolean);

// The codes of the countries a text names, by name or by adjective of nationality, in any of the languages of the data
// ("Jordan", "Jordanie", "giapponese"): a name of one to three words, an adjective of four letters at least, or three capitals ("UAE").
// "GB" is every nation of the United Kingdom and gives none of the four: their own words say them
export const countriesIn = (text) => {
    const found = new Set();
    const tokens = tokensOf(text);
    for (let at = 0; at < tokens.length; at++) {
        for (let length = 1; length <= 3 && at + length <= tokens.length; length++) {
            const words = tokens.slice(at, at + length);
            if (length === 1 && [...words[0]].length < 4 && !/^[A-Z]{3}$/.test(words[0])) continue;
            const key = mentionKey(words.join(' '));
            const code = countryNamed(words.join(' ')) ?? (length === 1 ? demonyms[key] ?? null : null);
            if (code && code !== 'GB') found.add(code);
        }
    }
    const small = mentionKey(String(text ?? ''));
    for (const [code, words] of Object.entries(NATION_WORDS)) {
        if (words.some(word => new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'u').test(small))) found.add(code);
    }
    return found;
};

// {ok, how} for the passage: member (a row of fifa-members.json), matched (the name of the passage that was found, as written), text (the
// title, the description and the sentence). "how" tells what decided it, for the audit
export const attribute = ({member, matched, text, lang = null}) => {
    const key = mentionKey(matched);
    const words = key.split(' ').filter(Boolean);
    if (member.level === 'confederation') {
        if (words.length > 1 || !CONFEDERATION_WORDS[member.fifa]) return {ok: true, how: 'confederation'};
        const small = mentionKey(text);
        // a word of its world, or another confederation named in the same text ("AFC joins CONMEBOL, CAF and OFC")
        if (CONFEDERATION_WORDS[member.fifa].test(small) || OTHER_CONFEDERATION.test(small.replace(new RegExp(`\\b${member.fifa.toLowerCase()}\\b`, 'g'), ' '))) return {ok: true, how: 'confederation_context'};
        return {ok: false, how: 'confederation_word'};
    }
    const own = member.iso;
    // the name says its country: "Japan Football Association", "Fédération allemande de football"
    if (countriesIn(matched).has(own)) return {ok: true, how: 'name_says_country'};
    const generic = GENERIC.has(key);
    const acronym = words.length === 1 && !generic;
    // a name of several words that no other association is called (the census keeps the names one association owns)
    if (words.length > 1 && !generic) return {ok: true, how: 'long_name'};
    // an acronym or a generic word: the country is in the text, and no other owner of the letters is
    const seen = countriesIn(text);
    const owners = acronym ? OWNERS.get(key) ?? new Set([own]) : new Set([own]);
    const rivals = [...owners].filter(code => code !== own && seen.has(code));
    // in an English text "The FA" is the association of England, unless another country is named
    if (own === 'GB-ENG' && lang === 'en' && ['fa', 'the fa'].includes(key) && !seen.has('GB-WLS') && !seen.has('GB-SCT') && !seen.has('GB-NIR') && [...seen].every(code => code === 'GB-ENG')) {
        return {ok: true, how: 'english_default'};
    }
    if (seen.has(own)) return rivals.length === 0 ? {ok: true, how: 'country_in_text'} : {ok: false, how: 'rival_country'};
    if (acronym && owners.size === 1 && owners.has(own)) return {ok: true, how: 'unique_acronym'};
    return {ok: false, how: rivals.length > 0 ? 'rival_country' : 'no_country'};
};
