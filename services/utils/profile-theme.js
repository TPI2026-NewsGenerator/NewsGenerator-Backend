//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: profile-theme.js
//  Description: The theme of a profile, the words that come back in its interests ("football", "referee"),
//               and which description of Wikidata holds one ("Spanish football manager"): among the
//               namesakes of a name the reader follows, the one of their theme is the one they mean
//

"use strict"

import {Filter} from "./filter.js";
import {countryNamed} from "./country-names.js";

const WORD = /\p{L}+/gu;
// a word is a theme from this long, and the most that are kept
const LEAST_LETTERS = 5;
const MOST_WORDS = 8;
// a word is the theme of a profile when it comes back, this many times in all and in this share of its interests:
// "football" in two of the four interests of a referee, who writes "refereeing" and "UEFA" for the rest; in one of
// two for a profile of two interests
const LEAST_TIMES = 3;
const LEAST_SHARE = 0.5;
// the words an interest is written with that say nothing of its subject, English and French
const GENERIC = new Set([
    'about', 'across', 'after', 'around', 'between', 'closely', 'coverage', 'deeper', 'developments', 'development', 'focus', 'follow', 'general',
    'global', 'include', 'including', 'important', 'level', 'levels', 'major', 'other', 'others', 'particular', 'particularly', 'potentially',
    'relevant', 'specific', 'their', 'there', 'these', 'those', 'update', 'updates', 'useful', 'where', 'which', 'while', 'within', 'world',
    'association', 'associations', 'federation', 'federations', 'national', 'international', 'nationale', 'nationales', 'nationaux',
    'actualite', 'actualites', 'aussi', 'autres', 'comme', 'cette', 'dernieres', 'general', 'generale', 'leurs', 'nouveau', 'nouveaux',
    'nouvelle', 'nouvelles', 'notamment', 'surtout', 'toutes', 'toute', 'tous', 'plus', 'veille', 'suivre', 'importants', 'importantes',
    'team', 'teams', 'equipe', 'equipes', 'training', 'europe', 'european', 'europeen', 'europeens', 'europeenne', 'europeennes',
    'asia', 'asian', 'africa', 'african', 'americas', 'american',
]);

const wordsOf = (text) => Filter.withoutAccents(String(text ?? '')).toLowerCase().match(WORD) ?? [];

// The theme of the interests of a profile: the words, at most MOST_WORDS, that come back in their keywords (in the
// text of an interest that has none), the ones in most interests first. The keywords are the terms of the subject,
// in the languages of the profile; the texts are prose, in French for a reader who asks for English descriptions
// ("arbitrage" for a referee) and full of words that name no subject ("America" of the America's Cup, which would
// make every "American actor" one of sailing). interests: [{text, keywords}]. [] when no word comes back
export const themeOf = (interests) => {
    const rows = (interests ?? []).map(({text, keywords}) => wordsOf(String(keywords ?? '').trim() ? keywords : text)
        .filter(word => word.length >= LEAST_LETTERS && !GENERIC.has(word) && !countryNamed(word)));
    const times = new Map();
    const inInterests = new Map();
    for (const row of rows) {
        for (const word of row) times.set(word, (times.get(word) ?? 0) + 1);
        for (const word of new Set(row)) inInterests.set(word, (inInterests.get(word) ?? 0) + 1);
    }
    const leastInterests = Math.max(1, Math.ceil(LEAST_SHARE * rows.length));
    return [...times.keys()]
        .filter(word => times.get(word) >= LEAST_TIMES && inInterests.get(word) >= leastInterests)
        .sort((a, b) => inInterests.get(b) - inInterests.get(a) || times.get(b) - times.get(a))
        .slice(0, MOST_WORDS);
};

// Two words of one family: the same start, all but 2 letters of the shorter at most left out ("football" and
// "footballer", "referee" and "refereeing", "arbitrage" and "arbitre"), 5 letters in common at least
const related = (a, b) => {
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    return common >= LEAST_LETTERS && common >= Math.min(a.length, b.length) - 2;
};

// The word of the theme a description holds, the first, or null: "English association football referee" holds
// "football" and "referee" for a profile of football refereeing. theme: see themeOf
export const holdsTheme = (theme, description) => {
    if (!theme?.length || !description) return null;
    const words = wordsOf(description);
    return theme.find(word => words.some(other => related(word, other))) ?? null;
};
