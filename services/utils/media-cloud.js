//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: media-cloud.js
//  Description: Media Cloud read as a second directory of media for the discovery, next to Google
//               News: the national and regional press writing on an interest, and the feeds its
//               directory knows for a medium
//

"use strict"

import process from 'node:process';
import {hostOf, nameOf} from './public-url.js';

// Media Cloud (search.mediacloud.org) indexes the press of each country, sorted in collections
// ("Switzerland - National"), and searches the whole text of its news. Measured on three profiles
// (bench/mc-measure.mjs): it names the press Google News does not (blick.ch/fr, sudinfo.be, lesoir.be,
// lalibre.be on football and space) and 11 of the 21 media only it named, tried like the others, gave
// a feed on the subject for the UEFA and the astronomy profiles. It knows no specialist site: nothing
// for the trading cards but newspapers writing once about a card shop. So it comes after Google News.
//
// It needs a key (MEDIACLOUD_API_TOKEN, free, 8000 requests a week) and answers 2 searches a minute
// ("query-rate": "2/m" in search/api-params): its searches go through one queue. Its directory is not
// limited that way. A refusal or a failure is never an error here, only an empty answer.
const API_URL = 'https://search.mediacloud.org/api';
const SEARCH_GAP_MS = 31000;
const PAUSE_MS = 15 * 60e3;         // after a refusal: its quota is weekly, asking again is useless
const TIMEOUT_MS = 60000;           // a search over a month of a country takes 5 to 20 seconds
const DAYS = 30;                    // the press of a month says which media write on it
const MIN_NEWS = 2;                 // under this it is a passing mention, not a medium covering the subject

// the collections of the press read in each language: its countries, national and regional. A
// collection of Switzerland holds its French and German press, the language of the news says which
const COLLECTIONS = {
    fr: [34412146, 38379799, 34411591, 38380954, 34412298],   // France, Switzerland, Belgium
    en: [34412234, 34412476, 38381111, 34411583],             // United States, United Kingdom, Canada
    de: [34412409, 34411591, 34412245],                       // Germany, Switzerland, Austria
    es: [34412356],                                           // Spain
    it: [34412372, 34411591],                                 // Italy, Switzerland
};

const TOKEN = () => process.env.MEDIACLOUD_API_TOKEN ?? '';
export const mediaCloudEnabled = () => TOKEN() !== '';

let queue = Promise.resolve();
let lastSearch = 0;
let pausedUntil = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ask = async (path, params) => {
    const res = await fetch(`${API_URL}/${path}?${new URLSearchParams(params)}`, {
        headers: {Authorization: `Token ${TOKEN()}`, Accept: 'application/json'},
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429) {
        pausedUntil = Date.now() + PAUSE_MS;
        throw new Error(`HTTP 429, no request for ${PAUSE_MS / 60e3} minutes`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

// a search in the queue, after the others and the gap
const search = (path, params) => {
    const run = queue.then(async () => {
        if (Date.now() < pausedUntil) throw new Error('paused after a refusal');
        const wait = lastSearch + SEARCH_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastSearch = Date.now();
        return ask(path, params);
    });
    queue = run.catch(() => {});
    return run;
};

// the words of a search asked together: its search reads the whole text with the words OR'ed, and
// "TCG news" answered every sport page saying "news". Only in the language asked
export const toQuery = (q, language) => {
    const words = String(q).replace(/[():"]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    const phrase = words.length > 1 ? `"${words.join(' ')}"` : words[0];
    return `${phrase} AND language:${language}`;
};

// the media of the press of this language writing on this search, the most present first
// [{site, name, news, lang}]
export const mediaFor = async (q, {language = 'en', days = DAYS} = {}) => {
    const query = toQuery(q, language);
    const collections = COLLECTIONS[language];
    if (!mediaCloudEnabled() || !query || !collections) return [];

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600e3);
    try {
        const {sources = []} = await search('search/sources', {
            q: query,
            start: start.toISOString().slice(0, 10),
            end: end.toISOString().slice(0, 10),
            platform: 'onlinenews-mediacloud',
            cs: collections.join(','),
        });
        return sources
            .filter(({source, count}) => hostOf(`https://${source}`) && count >= MIN_NEWS)
            .map(({source, count}) => ({site: source, name: source, news: count, lang: language}))
            .sort((a, b) => b.news - a.news);
    } catch (err) {
        console.log(`Media Cloud: no media for "${q}" (${err.message})`);
        return [];
    }
};

// its directory also lists the sitemaps of the media for Google News: no feed of news
export const isSitemap = (url) => /sitemap|googlenews|google_news|map_news|news\.xml/i.test(url);

// the feeds its directory knows for this medium: the ones a site declares nowhere (the sections of
// rssfeeds.freep.com, feeds.theuknews.com), to be checked like any other candidate
export const knownFeeds = async (site) => {
    if (!mediaCloudEnabled() || Date.now() < pausedUntil) return [];
    try {
        // a name search also answers other media (observer.com: zambianobserver.com): only this one
        const sameMedium = (host) => host && nameOf(host) === nameOf(site);
        const {results: sources = []} = await ask('sources/sources/', {name: site, limit: 5});
        const source = sources.find(found => sameMedium(found.name));
        if (!source) return [];
        const {results: feeds = []} = await ask('sources/feeds/', {source_id: source.id, limit: 20});
        return feeds.map(feed => feed.url).filter(url => url && !isSitemap(url) && sameMedium(hostOf(url)));
    } catch (err) {
        console.log(`Media Cloud: no feed known for ${site} (${err.message})`);
        return [];
    }
};
