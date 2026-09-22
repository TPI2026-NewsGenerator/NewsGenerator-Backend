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

export const Filter = { parse, toPattern, keywordsSql };
