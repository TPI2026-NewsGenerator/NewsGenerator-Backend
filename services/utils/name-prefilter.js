//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: name-prefilter.js
//  Description: Which news may name one of many names, read in memory before each name is checked on the
//               news that pass: 300 names against the news the tagger has not read yet, one test per name
//               and news, would take minutes
//

"use strict"

import {Filter} from "./filter.js";

const WORD = /[\p{L}\p{N}]+/gu;
// the scripts written without spaces between words: a name is looked for as a text in them
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const fold = (text) => Filter.withoutAccents(String(text ?? '')).toLowerCase();

// The test of a news (title, description): true when it holds the longest word of one of these names, its
// accents and case aside, or one of them as a text for the scripts without spaces. Never false for a news
// that names one of them as a whole word; the news that pass are checked name by name
export const mayName = (names) => {
    const heads = new Set();
    const runs = [];
    for (const name of names) {
        const folded = fold(name);
        if (UNSPACED.test(folded)) {
            runs.push(folded);
            continue;
        }
        const head = (folded.match(WORD) ?? []).reduce((best, word) => word.length > best.length ? word : best, '');
        if (head) heads.add(head);
    }
    return (article) => {
        const text = fold(`${article.title} ${article.description ?? ''}`);
        return runs.some(run => text.includes(run)) || (text.match(WORD) ?? []).some(word => heads.has(word));
    };
};
