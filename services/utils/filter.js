//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: filter.js
//  Description: News filtering system, keywords turned into SQL (the filter runs in Postgres, see FeedModel.searchArticles)
//

"use strict"

// Keywords like Google:
//  - commas separate alternatives (OR)
//  - the terms of an alternative must all be found, in any order (AND)
//  - "quoted text" is an exact word or phrase, other words also find their variants ("referee" -> "referees")
//  - short words (acronyms like VAR, NFL, AI) are whole words, else "VAR" would find "Variations" or "Alvarez"
//  - the case doesn't matter, except for a short word written in capitals: it is an acronym and must be
//    found in capitals, else "AI" would find the French "j'ai" or "n'ai" (the apostrophe ends a word).
//    "ai" written in lowercase still finds "AI" and "j'ai", the user may want that on purpose
const SHORT_WORD_LENGTH = 3;

// Postgres regex: [[:alnum:]] includes accented letters, so "préchauffe" doesn't start with "réchauffe"
const WORD_START = '(^|[^[:alnum:]])';
const WORD_END = '([^[:alnum:]]|$)';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 'referee -rugby, "red card"' -> {
//   groups: [[{text: 'referee', exact: false}], [{text: 'red card', exact: true}]],
//   excluded: [{text: 'rugby', exact: false}]
// }
// a term starting with '-' excludes the news that contain it, whatever the alternatives ('-"red card"' works too)
const parse = (keywords) => {
    const groups = [];
    const excluded = [];

    for (let keyword of keywords ?? []) {
        // split on commas outside quotes
        const parts = String(keyword).match(/(?:"[^"]*"?|[^,"])+/g) ?? [];

        for (let part of parts) {
            const terms = [];
            for (let [, minus, phrase, word] of part.matchAll(/(-?)(?:"([^"]*)"?|([^\s"]+))/g)) {
                const text = (phrase !== undefined ? phrase : word).trim();
                if (!text) continue;

                const term = { text, exact: phrase !== undefined };
                if (minus) excluded.push(term); else terms.push(term);
            }
            if (terms.length > 0) groups.push(terms);
        }
    }

    return { groups, excluded };
};

// Postgres ARE option at the start of a regex: case-sensitive, even with ~*
const CASE_SENSITIVE = '(?c)';

// "AI", "VAR", "5G", not "ai", "Var" or "42"
const isAcronym = (text) =>
    text.length <= SHORT_WORD_LENGTH && text === text.toUpperCase() && text !== text.toLowerCase();

// Postgres regex of a term, used case-insensitive with ~* (acronyms turn it case-sensitive, see CASE_SENSITIVE).
// Its letters are searched with and without their accents, as the JavaScript matcher below: "-Barça"
// left the news writing "Barca", "Zürich" found 52 news of 30 days and 218 with "Zurich".
// By classes of letters ("[aàáâãäå]") unless fold is given: Postgres then folds the accents of the text and of the pattern
// (see keywordsSql) and the letters are written as they are. The index of trigrams reads a class of more than 4 letters as any
// letter, so "infantino" had almost no trigram left to ask for and the search of a week on every feed took 30 to 60 s (0.6 s with the
// letters as they are, 4.2 million news, 11.11.2026)
const toPattern = ({ text, exact }, { fold = false } = {}) => {
    const options = isAcronym(text) ? CASE_SENSITIVE : '';
    const literal = (part) => fold ? escapeRegex(part) : anyAccent(escapeRegex(part));
    if (exact) {
        return options + WORD_START + text.split(/\s+/).map(literal).join('[[:space:]]+') + WORD_END;
    }
    const end = text.length <= SHORT_WORD_LENGTH ? WORD_END : '';
    return options + WORD_START + literal(text) + end;
};

const MIN_FOLDED = 3;

// SQL condition on 'column' (the text searched, see articles.search_text in db/add_articles_search.sql),
// the patterns are parameters numbered from $firstParam
// alternatives with OR, their terms with AND, excluded terms with NOT:
// "(col ~* $4) OR (col ~* $5 AND col ~* $6) AND NOT (col ~* $7)"
// fold: the name of a SQL function that takes the accents off a text (db/add_plain_search.sql: public.plain_text), applied to the column and to
// each pattern, whose letters are then written as they are: "fold(col) ~* fold($4::text)". The index of the expression answers it. null: the
// accents are in classes of letters in the patterns, as before the index existed
// null when there is nothing to filter
const keywordsSql = ({groups, excluded}, firstParam, column, { fold = null } = {}) => {
    const params = [];
    const match = (term) => {
        // only the terms the index of trigrams can serve are folded: three letters or digits at least, and no acronym in capitals (its regex is
        // case-sensitive, which the index does not answer: "VAR" reads every news of the window, 1.4 s on 546 000 news and 3.8 s with the accents
        // folded of each). The others keep the classes of accents on the column as it is, scanned as before
        const folded = Boolean(fold) && !isAcronym(term.text) && term.text.replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_FOLDED;
        params.push(toPattern(term, { fold: folded }));
        const param = `$${firstParam + params.length - 1}`;
        return folded ? `${fold}(${column}) ~* ${fold}(${param}::text)` : `${column} ~* ${param}`;
    };

    const wanted = groups.map(terms => '(' + terms.map(match).join(' AND ') + ')').join(' OR ');
    const unwanted = excluded.map(match).join(' OR ');

    if (!wanted && !unwanted) return null;

    const conditions = [];
    if (wanted) conditions.push(`(${wanted})`);
    if (unwanted) conditions.push(`NOT (${unwanted})`);

    return { sql: conditions.join(' AND '), params };
};

// Several words mean "all of them", which is exact but merciless: "referee football soccer" asks
// for the three in the same news and finds almost nothing. On Google the same words would only
// rank the results, never remove them, so a search that finds close to nothing is asked again for
// any of the words. The excluded ones (-word) are kept: they were asked for on purpose.
const canWiden = ({groups}) => groups.some(terms => terms.length > 1);

const widen = ({groups, excluded}) => ({groups: groups.flat().map(term => [term]), excluded});

// The keywords written again from what parse read, searching the same: 'referee -rugby, "red card"'
// gives 'referee, "red card", -rugby'. The wider search is offered this way, its exact phrases and
// excluded words with it: run from its words alone, it was not the one counted
const toKeywords = ({groups, excluded}) => {
    const written = ({text, exact}) => exact ? `"${text}"` : text;
    return [...groups.map(terms => terms.map(written).join(' ')), ...excluded.map(term => `-${written(term)}`)].join(', ');
};

// The same keywords read in JavaScript, for texts that are not in the database yet (the items of a
// feed being chosen, see findFeeds). The accents are ignored on both sides: "defile" finds "défilé".
// The letters and digits are listed without the i flag: under /iu a negated \p{} class also refuses
// the capitals, so the case is removed from the text instead
const withoutAccents = (text) => text.normalize('NFD').replace(/\p{M}/gu, '');

// The letters of Latin-1 with an accent, by the letter without it: "e" -> "èéêë". A letter of a term
// is searched as any of them ("Barça" -> "B[aàáâãäå]r[cç][aàáâãäå]"), the other scripts as written.
// Measured on 30 days at 1 million news (bench/accent-patterns.mjs): 8 to 100 ms a term, the trigram index still used;
// with Latin Extended-A too (Polish, Czech...) up to 330 ms, and 1 s with every Latin letter. At 4.2 million news the classes
// cost 30 to 60 s a week (see toPattern, fold): they stay for the texts Postgres does not fold (JavaScript below, the search before
// the index of the folded text is built, the terms it cannot serve)
const ACCENTED = new Map();
for (let code = 0xC0; code <= 0xFF; code++) {
    const letter = String.fromCodePoint(code);
    const base = withoutAccents(letter);
    if (/^[A-Za-z]$/.test(base) && base !== letter) ACCENTED.set(base, (ACCENTED.get(base) ?? '') + letter);
}
const anyAccent = (text) => [...text].map(char => {
    const base = withoutAccents(char);
    return /^[A-Za-z]$/.test(base) && ACCENTED.has(base) ? `[${base}${ACCENTED.get(base)}]` : char;
}).join('');
const WORD_START_JS = '(?:^|[^\\p{L}\\p{N}])';
const WORD_END_JS = '(?=[^\\p{L}\\p{N}]|$)';

// An acronym in a run of words written all in capitals can't be told from a word: a title shouted whole
// ("LA VALETTE-DU-VAR : Octobre Rose") named the commune, not the video assistant, in 3 of the first 5
// of 39 news of "VAR" on 8.10.2026. It counts out of such runs only; two acronyms side by side still
// count ("UEFA VAR"), and the description of a shouted title is read as well
const SHOUTED_RUN = 3;
const WORD_JS = /[\p{L}\p{N}]+/gu;
// of two letters at least: the elided "L'" of "L'UEFA VAR" is no shouted word
const isCapitals = (word) => word.length >= 2 && word === word.toUpperCase() && word !== word.toLowerCase();
const shoutedAt = (text, index) => {
    const words = [...text.matchAll(WORD_JS)];
    const at = words.findIndex(word => index >= word.index && index < word.index + word[0].length);
    if (at < 0) return false;
    let first = at, last = at;
    while (first > 0 && isCapitals(words[first - 1][0])) first--;
    while (last < words.length - 1 && isCapitals(words[last + 1][0])) last++;
    return last - first + 1 >= SHOUTED_RUN;
};

// the term, its regex (its body in the group 1), and whether it is an acronym
const termRegex = ({text, exact}) => {
    const acronym = isAcronym(text);
    const term = withoutAccents(acronym ? text : text.toLowerCase());
    const body = exact ? term.split(/\s+/).map(escapeRegex).join('\\s+') : escapeRegex(term);
    const end = exact || term.length <= SHORT_WORD_LENGTH ? WORD_END_JS : '';
    return {acronym, regex: new RegExp(WORD_START_JS + `(${body})` + end, 'gu')};
};

// The places of a term in a text, [[start, end]] of its body: an acronym in the text as written, out of
// the shouted runs; anything else in lowercase
const foundIn = ({acronym, regex}, original, lowered) => (acronym
    ? [...original.matchAll(regex)].map(found => [found.index + found[0].length - found[1].length, found.index + found[0].length])
        .filter(([start]) => !shoutedAt(original, start))
    : [...lowered.matchAll(regex)].map(found => [found.index + found[0].length - found[1].length, found.index + found[0].length]));

const toRegex = (term) => {
    const search = termRegex(term);
    return (original, lowered) => foundIn(search, original, lowered).length > 0;
};

// The text without its accents and in lowercase, as the matcher reads it, and where each of their
// characters comes from in the text as written: a letter with an accent may be two characters once
// decomposed, and a few letters change their length in lowercase ("İ")
const readable = (text) => {
    let original = '', lowered = '';
    const fromOriginal = [], fromLowered = [];          // [start, end] in the text as written
    for (let i = 0; i < text.length;) {
        const char = String.fromCodePoint(text.codePointAt(i));
        const plain = withoutAccents(char);
        const lower = plain.toLowerCase();
        for (let k = 0; k < plain.length; k++) fromOriginal.push([i, i + char.length]);
        for (let k = 0; k < lower.length; k++) fromLowered.push([i, i + char.length]);
        original += plain;
        lowered += lower;
        i += char.length;
    }
    return {original, lowered, fromOriginal, fromLowered};
};

// The places of the terms followed in a text, as the briefing finds them (exact words, see
// watchedNews): [[start, end]] in the text as written, in order and never overlapping. The page shows
// them marked
const highlights = (text, terms) => {
    if (!text || !terms?.length) return [];
    const read = readable(String(text));
    const ranges = terms.flatMap(term => {
        const search = termRegex({text: String(term).trim(), exact: true});
        const from = search.acronym ? read.fromOriginal : read.fromLowered;
        return foundIn(search, read.original, read.lowered)
            .filter(([start, end]) => end > start)
            .map(([start, end]) => [from[start][0], from[end - 1][1]]);
    }).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const [start, end] of ranges) {
        const last = merged.at(-1);
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged;
};

// text -> true when it matches the keywords, like keywordsSql would; null when there is nothing to match
const matcher = ({groups, excluded}) => {
    if (groups.length === 0 && excluded.length === 0) return null;

    const wanted = groups.map(terms => terms.map(toRegex));
    const unwanted = excluded.map(toRegex);

    return (text) => {
        const original = withoutAccents(text ?? '');
        const lowered = original.toLowerCase();
        const has = (test) => test(original, lowered);

        return (wanted.length === 0 || wanted.some(terms => terms.every(has))) && !unwanted.some(has);
    };
};

// A search is written as a sentence ("the new rules for scooters in Paris") and found by its meaning,
// or with the operators above when the reader wants exact words: quotes, a comma or -word say it
const hasOperators = (keywords) => (keywords ?? []).some(keyword => /["“”,]|(?:^|\s)-\S/.test(String(keyword)));

export const Filter = { parse, toPattern, keywordsSql, canWiden, widen, toKeywords, matcher, withoutAccents, hasOperators, highlights };
