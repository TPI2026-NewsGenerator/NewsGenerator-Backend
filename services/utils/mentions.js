//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: mentions.js
//  Description: The names the tagger finds in a news (ner/server.py), as they are stored and compared,
//               and the ones of a card rare enough to find the other news of its affair. Pure
//

"use strict"

export const KINDS = ['person', 'organization', 'location'];
// the places that found no item before this date are looked for once more when a card names them (see MentionModel.want): the rules that
// link a place changed (the Wikipedia of its language, the country the items called so share), 8.11.2026
export const PLACES_RULES_FROM = new Date('2026-11-09T00:00:00Z');
const MAX_NAME = 120;

// "La Fédération lettone de football" and "Fédération lettone de football" are one name; "Los Angeles"
// and "Le Mans" keep theirs: an article goes only when two words at least are left
const ARTICLES = /^(the|le|la|les|der|die|das|el|los|las|il|lo|gli|het)\s+(?=\S+\s+\S)/;
const EDGES = /^[\s"'«»“”„‘’`()[\]{}.,:;!?|/\\*–—-]+|[\s"'«»“”„‘’`()[\]{}.,:;!?|/\\*–—-]+$/g;
// the letters with no accent to take off, written as without one ("Wisła Kraków", "Wisla Krakow")
const LETTERS = {ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', þ: 'th', ð: 'd', ħ: 'h'};

// The name as it is compared: small letters, no accent, one space between words, no quote nor dot
// around it, no "'s" of the English possessive ("UEFA's"), no leading article. '' for none
export const mentionKey = (name) => String(name ?? '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łøđßæœıþðħ]/g, letter => LETTERS[letter])
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(EDGES, '')
    .replace(/'s$/, '')
    .replace(ARTICLES, '')
    .trim();

// The acronyms inside a longer name: the tagger gives "UEFA Nations League", "FIFA-Präsident", "Le
// PSG" as one name, and the news names the UEFA, the FIFA, the PSG too. On 2662 news of 30 days
// (bench/ner-recall.mjs, 13.10.2026) the names of the UEFA were in 72 of what the tagger read and in 35
// of its names, Infantino in 17 and 16. A roman figure ("LFF II lyga") is none
const ACRONYM = /^[A-Z][A-Z0-9&]{1,5}$/;
const ROMAN = /^[IVXLCDM]+$/;
export const acronymsOf = (name) => {
    const words = name.split(/[\s\-–/]+/);
    return words.length < 2 ? [] : words.filter(word => ACRONYM.test(word) && /[A-Z].*[A-Z]/.test(word) && !ROMAN.test(word));
};

// The particles Korean and Japanese glue to a name written in Latin letters: "KFA는" is the KFA (the tagger gave 349 organisations
// so, 8.11.2026). A word of the language after the name is none ("AC밀란", "FIFA회장" stay as they are)
const PARTICLES = '은|는|이|가|을|를|의|와|과|도|에|로|으로|에서|에게|부터|까지|만|が|は|を|に|の|で|と|も|へ|や|から|まで|より';
const WITH_PARTICLE = new RegExp(`^([\\p{Script=Latin}\\d][\\p{Script=Latin}\\d&.'’ -]*[\\p{Script=Latin}\\d])(?:${PARTICLES})$`, 'u');
export const withoutParticle = (name) => WITH_PARTICLE.exec(name)?.[1] ?? name;

// The names of one news as stored: once per name and kind, of the kinds asked, a letter at least and
// not too long (a sentence taken for a name), and the acronyms inside them as organisations.
// entities: as the tagger gives them, [{text, label, score}]
export const cleanMentions = (entities) => {
    const seen = new Set();
    const names = [];
    const add = (name, kind) => {
        const key = mentionKey(name);
        if (!KINDS.includes(kind) || key.length < 2 || name.length > MAX_NAME || !/\p{L}/u.test(key)) return false;
        if (seen.has(`${kind} ${key}`)) return true;
        seen.add(`${kind} ${key}`);
        names.push({key, kind, name});
        return true;
    };
    for (const entity of Array.isArray(entities) ? entities : []) {
        const name = withoutParticle(String(entity?.text ?? '').replace(/\s+/g, ' ').replace(EDGES, ''));
        if (add(name, entity?.label)) acronymsOf(name).forEach(acronym => add(acronym, 'organization'));
    }
    return names;
};

// The names of a card that find the other news of its affair: a person or a body (a country or a city
// is named by too many news), named by the most news of the card, then by the fewest news of the month:
// the Latvian federation (LFF) finds what it said a week before, the UEFA every news of football. A
// name only the card holds finds nothing more. rows: [{id, kind, inCard, news}], news counted up to
// rare + 1
export const rareNames = (rows, {rare, max}) => rows
    .filter(row => row.kind !== 'location' && row.news <= rare && row.news > row.inCard)
    .sort((a, b) => b.inCard - a.inCard || a.news - b.news)
    .slice(0, max);
