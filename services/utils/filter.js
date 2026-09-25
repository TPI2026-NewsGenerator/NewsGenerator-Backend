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

// Postgres regex of a term, used case-insensitive with ~* (acronyms turn it case-sensitive, see CASE_SENSITIVE)
const toPattern = ({ text, exact }) => {
    const options = isAcronym(text) ? CASE_SENSITIVE : '';
    if (exact) {
        return options + WORD_START + text.split(/\s+/).map(escapeRegex).join('[[:space:]]+') + WORD_END;
    }
    const end = text.length <= SHORT_WORD_LENGTH ? WORD_END : '';
    return options + WORD_START + escapeRegex(text) + end;
};

// SQL condition on 'column' (the text searched, see articles.search_text in db/add_articles_search.sql),
// the patterns are parameters numbered from $firstParam
// alternatives with OR, their terms with AND, excluded terms with NOT:
// "(col ~* $4) OR (col ~* $5 AND col ~* $6) AND NOT (col ~* $7)"
// null when there is nothing to filter
const keywordsSql = ({groups, excluded}, firstParam, column) => {
    const params = [];
    const match = (term) => {
        params.push(toPattern(term));
        return `${column} ~* $${firstParam + params.length - 1}`;
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

// The same keywords read in JavaScript, for texts that are not in the database yet (the items of a
// feed being chosen, see findFeeds). The accents are ignored on both sides: "defile" finds "défilé".
// The letters and digits are listed without the i flag: under /iu a negated \p{} class also refuses
// the capitals, so the case is removed from the text instead
const withoutAccents = (text) => text.normalize('NFD').replace(/\p{M}/gu, '');
const WORD_START_JS = '(?:^|[^\\p{L}\\p{N}])';
const WORD_END_JS = '(?=[^\\p{L}\\p{N}]|$)';

const toRegex = ({text, exact}) => {
    const acronym = isAcronym(text);
    const term = withoutAccents(acronym ? text : text.toLowerCase());
    const body = exact ? term.split(/\s+/).map(escapeRegex).join('\\s+') : escapeRegex(term);
    const end = exact || term.length <= SHORT_WORD_LENGTH ? WORD_END_JS : '';
    const regex = new RegExp(WORD_START_JS + body + end, 'u');

    // an acronym is searched in the text as written, anything else in lowercase
    return (original, lowered) => regex.test(acronym ? original : lowered);
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

export const Filter = { parse, toPattern, keywordsSql, canWiden, widen, matcher, withoutAccents };
