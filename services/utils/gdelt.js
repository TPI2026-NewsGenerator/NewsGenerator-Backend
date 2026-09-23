//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: gdelt.js
//  Description: GDELT read as a second directory of media, next to Google News
//

"use strict"

import {Filter} from './filter.js';
import {hostOf} from './public-url.js';

// GDELT indexes the press of 65 languages and names the real domain of every article it finds.
// Its ranking is poor for reading (it is a full text index, not an editor: a search for "referee"
// answers case law and a dentist magazine), so its news are never shown. But the media it names
// are largely not the ones Google News names, and for discovering media the noise costs little:
// a medium writing once about the subject is dropped, one writing several times is a candidate.
//
// The service is free and needs no key, but it is slow and refuses one request out of two under
// load, so a failure here answers nothing instead of breaking the search.
const API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MAX_RECORDS = 250;
const TIMEOUT_MS = 12000;
const MIN_NEWS = 2;             // under this it is a passing mention, not a medium covering the subject

// the languages GDELT names the way we do
const LANGUAGES = {en: 'eng', fr: 'fre', es: 'spa', de: 'ger', it: 'ita'};

// our keywords with the GDELT operators: alternatives with OR between parentheses, "quotes" for a
// phrase, and the excluded ones with a minus, like Google
export const toQuery = (keywords, {language = 'en'} = {}) => {
    const {groups, excluded} = Filter.parse(keywords);
    const quote = ({text, exact}) => exact || /\s/.test(text) ? `"${text}"` : text;

    const alternatives = groups.map(terms => terms.map(quote).join(' '));
    const wanted = alternatives.length > 1
        ? '(' + alternatives.map(terms => terms).join(' OR ') + ')'
        : alternatives[0] ?? '';

    if (!wanted) return '';

    return [wanted, ...excluded.map(term => `-${quote(term)}`), `sourcelang:${LANGUAGES[language] ?? 'eng'}`].join(' ');
};

// media publishing on this subject: [{site, news}], the one publishing the most first
export const mediaFor = async (keywords, {days = 2, language = 'en'} = {}) => {
    const query = toQuery(keywords, {language});
    if (!query) return [];

    const url = `${API_URL}?query=${encodeURIComponent(query)}`
        + `&mode=artlist&maxrecords=${MAX_RECORDS}&timespan=${Math.max(1, Math.ceil(days))}d`
        + '&format=json&sort=datedesc';

    let articles;
    try {
        const res = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
        const text = await res.text();

        // when it refuses, GDELT answers a sentence in plain text, not an error code
        if (!res.ok || !text.trimStart().startsWith('{')) return [];

        articles = JSON.parse(text).articles ?? [];
    } catch {
        return [];
    }

    const media = new Map();
    for (const article of articles) {
        const site = hostOf(article.url) ?? (article.domain ? article.domain.replace(/^www\./, '') : null);
        if (!site) continue;

        media.set(site, (media.get(site) ?? 0) + 1);
    }

    return [...media.entries()]
        .filter(([, news]) => news >= MIN_NEWS)
        .sort((a, b) => b[1] - a[1])
        .map(([site, news]) => ({site, name: site, news}));
};
