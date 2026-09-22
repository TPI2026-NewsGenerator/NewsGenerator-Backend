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
const SHORT_WORD_LENGTH = 3;

// Postgres regex: [[:alnum:]] includes accented letters, so "préchauffe" doesn't start with "réchauffe"
const WORD_START = '(^|[^[:alnum:]])';
const WORD_END = '([^[:alnum:]]|$)';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 'referee, "red card" var' -> [[{text: 'referee', exact: false}], [{text: 'red card', exact: true}, {text: 'var', exact: false}]]
const parse = (keywords) => {
    const groups = [];

    for (let keyword of keywords ?? []) {
        // split on commas outside quotes
        const parts = String(keyword).match(/(?:"[^"]*"?|[^,"])+/g) ?? [];

        for (let part of parts) {
            const terms = [];
            for (let [, phrase, word] of part.matchAll(/"([^"]*)"?|([^\s"]+)/g)) {
                if (phrase !== undefined && phrase.trim()) terms.push({ text: phrase.trim(), exact: true });
                if (word) terms.push({ text: word, exact: false });
            }
            if (terms.length > 0) groups.push(terms);
        }
    }

    return groups;
};

// Postgres regex of a term, used case-insensitive with ~*
const toPattern = ({ text, exact }) => {
    if (exact) {
        return WORD_START + text.split(/\s+/).map(escapeRegex).join('[[:space:]]+') + WORD_END;
    }
    const end = text.length <= SHORT_WORD_LENGTH ? WORD_END : '';
    return WORD_START + escapeRegex(text) + end;
};

// SQL condition on 'column' (the text searched, see articles.search_text in db/add_articles_search.sql),
// the patterns are parameters numbered from $firstParam
// [[a], [b, c]] -> "(a.search_text ~* $4) OR (a.search_text ~* $5 AND a.search_text ~* $6)"
const keywordsSql = (groups, firstParam, column) => {
    const params = [];
    const sql = groups
        .map(terms => '(' + terms.map(term => {
            params.push(toPattern(term));
            return `${column} ~* $${firstParam + params.length - 1}`;
        }).join(' AND ') + ')')
        .join(' OR ');

    return { sql, params };
};

export const Filter = { parse, toPattern, keywordsSql };
