//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: watch-terms.js
//  Description: The names or words a profile follows: every news that names one is shown in a section of
//               the briefing of its own (see watchedNews in briefing-service.js)
//

"use strict"

export const MAX_WATCH_TERMS = 20;
// searched as a whole word: one letter would find everything, a sentence nothing
const TERM_CHARS = [2, 60];

const badRequest = (message) => Object.assign(new Error(message), {status: 400});

// the terms as the reader wrote them, each once whatever its case, without quotes (a term is searched
// as an exact phrase already), the empty ones left out
export const cleanWatchTerms = (terms) => {
    if (!Array.isArray(terms)) throw badRequest('terms: the names or words to follow.');
    const kept = new Map();
    for (const term of terms) {
        const written = typeof term === 'string' ? term.replace(/["\s]+/g, ' ').trim() : '';
        if (!written) continue;
        if (written.length < TERM_CHARS[0] || written.length > TERM_CHARS[1]) {
            throw badRequest(`A term is ${TERM_CHARS[0]} to ${TERM_CHARS[1]} characters: "${written}".`);
        }
        if (!kept.has(written.toLowerCase())) kept.set(written.toLowerCase(), written);
    }
    if (kept.size > MAX_WATCH_TERMS) throw badRequest(`At most ${MAX_WATCH_TERMS} terms.`);
    return [...kept.values()];
};
