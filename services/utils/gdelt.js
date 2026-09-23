//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: gdelt.js
//  Description: GDELT read as a second directory of media, next to Google News
//

"use strict"

import https from 'node:https';
import {log} from 'crawlee';
import {Filter} from './filter.js';
import {hostOf} from './public-url.js';

// GDELT indexes the press of 65 languages and names the real domain of every article it finds.
// Its ranking is poor for reading (it is a full text index, not an editor: a search for "referee"
// answers case law and a dentist magazine), so its news are never shown. But the media it names
// are largely not the ones Google News names, and for discovering media the noise costs little:
// a medium writing once about the subject is dropped, one writing several times is a candidate.
//
// The service is free and needs no key, but it takes 10 to 22 seconds to answer and refuses most
// requests with "one request every 5 seconds" even when waited for far longer. So the delay is the
// caller's to choose: a search gives it a few seconds and goes on without it, the sweep of
// scripts/find-missing-sources.js waits and tries again, nobody waiting there. A refusal is never
// an error here, only an empty answer.
const API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MAX_RECORDS = 250;
const TIMEOUT_MS = 6000;        // what a search can spare, it will rarely be enough
const RETRY_MS = 20000;         // its real limit is far above the 5 seconds it names
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

// fetch() gives up after 10 seconds whatever its AbortSignal says, and reports a connection error
// while GDELT is only being slow. Asking node for the request lets the delay be ours, and shows
// the real answer: most of the time a 429 saying we asked too often.
const get = (url, timeoutMs) => new Promise((resolve, reject) => {
    const request = https.get(url, {timeout: timeoutMs}, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({status: res.statusCode, body}));
    });

    request.on('timeout', () => request.destroy(new Error(`no answer in ${timeoutMs}ms`)));
    request.on('error', reject);
});

// media publishing on this subject: [{site, news}], the one publishing the most first
// 'timeoutMs' and 'tries' say how long the caller is willing to wait for a slow service
export const mediaFor = async (keywords, {days = 2, language = 'en', timeoutMs = TIMEOUT_MS, tries = 1} = {}) => {
    const query = toQuery(keywords, {language});
    if (!query) return [];

    const url = `${API_URL}?query=${encodeURIComponent(query)}`
        + `&mode=artlist&maxrecords=${MAX_RECORDS}&timespan=${Math.max(1, Math.ceil(days))}d`
        + '&format=json&sort=datedesc';

    let articles = null;
    for (let attempt = 1; attempt <= tries && articles === null; attempt++) {
        if (attempt > 1) await new Promise(resolve => setTimeout(resolve, RETRY_MS));

        try {
            const {status, body} = await get(url, timeoutMs);

            // when it refuses, GDELT answers a sentence in plain text, not an error code
            if (status === 200 && body.trimStart().startsWith('{')) {
                articles = JSON.parse(body).articles ?? [];
            } else {
                log.debug(`GDELT refused (${status}): ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
            }
        } catch (err) {
            log.debug(`GDELT did not answer: ${err.message}`);
        }
    }

    return articles === null ? [] : mediaOf(articles);
};

// the media of a list of articles, the one publishing the most first. A medium naming the subject
// only once is a passing mention, not a medium covering it
export const mediaOf = (articles) => {
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
