//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-source.js
//  Description: The source a reader joins to their choice on the map of the FIFA presidency (a link to the page that says it). The address is checked before it is
//               kept (http or https, no password in it, public: the server fetches it), the page is read as the news are (the same passages, the same attribution by
//               code, the same two readings) and the result says whether the page SAYS what the reader chose, says the OTHER thing, or does not say it clearly.
//               It informs and decides nothing: the choice of the reader stays what colours the map
//
//               cleanSourceUrl, newsOfPage, passagesOfSource and checkOf are pure; readSourcePage fetches
//

"use strict"

import {Readability} from '@mozilla/readability';
import {parseHTML} from 'linkedom';
import {discardBody, fetchPublicUrl, guardFetch, hostOf, mediumOf, readText} from './public-url.js';
import {passagesOf} from './fifa-passages.js';

export const SOURCE_CHECKS = ['pending', 'says', 'contradicts', 'unclear', 'unreadable'];
const MAX_URL = 500;
const MAX_PAGE_CHARS = 3_000_000;          // a page larger than this is not read
const MAX_TEXT_CHARS = 120_000;            // what is kept of the text of an article
const MAX_PASSAGES = 6;                    // the passages read at most (about 4 600 tokens each)
const PAGE_TIMEOUT_MS = 20000;
const PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)',
    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr,en;q=0.8,de;q=0.6,it;q=0.5,es;q=0.5',
};

const fail = (status, message) => Object.assign(new Error(message), {status});

// The address of a source as it is kept, or an error 422 saying what is wrong with it. That it is public (not the network of the server) is checked by
// assertPublicUrl (public-url.js) where the answer may wait for a DNS lookup
export const cleanSourceUrl = (value) => {
    const text = String(value ?? '').trim();
    if (text === '') throw fail(422, 'source: the address of the page.');
    if (text.length > MAX_URL) throw fail(422, `source: an address of ${MAX_URL} characters at most.`);
    let url;
    try {
        url = new URL(text);
    } catch {
        throw fail(422, 'source: not an address.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw fail(422, 'source: an http or https address.');
    if (url.username || url.password) throw fail(422, 'source: an address with no name or password in it.');
    url.hash = '';
    return url.href;
};

// {url, medium} from what the page sent: a string or {url}
export const sourceOfBody = (source) => {
    if (source === undefined || source === null || source === '') return null;
    const url = cleanSourceUrl(typeof source === 'string' ? source : source.url);
    return {url, medium: mediumOf(hostOf(url) ?? '')};
};

// The text of the page the reader gave: {title, description, text, lang, publishedAt} or null when it cannot be read as an article (not a page, too large, nothing in it)
export const readSourcePage = async (url) => {
    guardFetch();
    const {res} = await fetchPublicUrl(url, {headers: PAGE_HEADERS, timeoutMs: PAGE_TIMEOUT_MS, maxRedirects: 5});
    const size = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || !/html|xml/i.test(res.headers.get('content-type') ?? 'text/html') || size > MAX_PAGE_CHARS) {
        await discardBody(res);
        return null;
    }
    const html = await readText(res, PAGE_TIMEOUT_MS);
    if (html.length > MAX_PAGE_CHARS) return null;
    const {document} = parseHTML(html);
    const article = new Readability(document).parse();
    const blocks = String(article?.textContent ?? '').split(/\n+/).map(block => block.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!article || blocks.length === 0) return null;
    return {title: article.title ?? '', description: article.excerpt ?? '', text: blocks.join(' | ').slice(0, MAX_TEXT_CHARS), lang: article.lang || document.documentElement?.getAttribute('lang') || null,
        publishedAt: article.publishedTime ?? ''};
};

// the page as one news of the pipeline (passagesOf reads a list of them)
export const newsOfPage = ({page, url, now = new Date()}) => {
    const date = new Date(page.publishedAt);
    return {id: 'source', title: page.title, description: page.description, text: page.text, lang: page.lang ? String(page.lang).slice(0, 2).toLowerCase() : null,
        medium: mediumOf(hostOf(url) ?? ''), story: null, link: url, at: Number.isNaN(date.getTime()) || date > now ? now : date};
};

// The passages of the page that name the association AND the candidate, at most MAX_PASSAGES, the ones with a word of support or opposition first. The reader
// says which association the page is about, so its names count as linked in this page (the short acronym too): the attribution by code in readPassage still
// refuses an acronym with no country in the text
export const passagesOfSource = ({page, url, member, subject, index, members, now = new Date()}) => {
    const news = newsOfPage({page, url, now});
    const names = [member.association ?? member.name, ...(member.acronyms ?? [])].filter(Boolean);
    const linked = new Map([[news.id, names.map(name => ({qid: member.qid, name}))]]);
    return passagesOf({news: [news], linked, index, members, terms: subject.terms ?? []})
        .filter(passage => passage.member.qid === member.qid)
        .sort((a, b) => Number(b.stanceWords.support || b.stanceWords.oppose) - Number(a.stanceWords.support || a.stanceWords.oppose))
        .slice(0, MAX_PASSAGES);
};

// What the page says compared with what the reader chose. expected: "for" or "against" (the side of the choice); readings: [{passage, reading}] of readPassage.
// Only an ESTABLISHED reading (two models, a quote held, an attribution by code) says something: "says" when one is on the side of the reader, "contradicts" when
// the only ones are on the other side, "unclear" otherwise; null when no reading could be made (the AI did not answer): the check is made again later
export const checkOf = ({readings, expected}) => {
    if (readings.length > 0 && readings.every(one => one.reading.unreadable)) return null;
    const established = readings.filter(one => one.reading.status === 'established');
    const best = (list) => [...list].sort((a, b) => Number(b.reading.level === 'declared') - Number(a.reading.level === 'declared'))[0];
    const same = established.filter(one => one.reading.stance === expected);
    if (same.length > 0) return {check: 'says', found: String(best(same).passage.sentence).replace(/\s+/g, ' ').slice(0, 400)};
    const other = established.filter(one => one.reading.stance !== expected);
    if (other.length > 0) return {check: 'contradicts', found: String(best(other).passage.sentence).replace(/\s+/g, ' ').slice(0, 400)};
    return {check: 'unclear', found: ''};
};

// The passages of a page for SEVERAL candidates (a source a reader adds on its own, with no candidate): for each candidate the ones that name the association and him,
// the ones with a word of support or opposition first, at most MAX_PASSAGES in all (about 4 600 tokens each). [{subject, passage}]
export const passagesOfPage = ({page, url, member, subjects, index, members, now = new Date()}) => subjects
    .flatMap(subject => passagesOfSource({page, url, member, subject, index, members, now}).map(passage => ({subject, passage})))
    .sort((a, b) => Number(b.passage.stanceWords.support || b.passage.stanceWords.oppose) - Number(a.passage.stanceWords.support || a.passage.stanceWords.oppose))
    .slice(0, MAX_PASSAGES);

// What a page says when no side was expected: the established readings, one for each candidate (the declared one first). entries: [{subject, passage, reading}] ->
// {check: "says" (at least one), "unclear" (none), readings: [{subject_qid, stance, level, found}]}; null when every reading failed (the check is made again later)
export const readingsOfPage = (entries) => {
    if (entries.length > 0 && entries.every(one => one.reading.unreadable)) return null;
    const established = entries.filter(one => one.reading.status === 'established')
        .sort((a, b) => Number(b.reading.level === 'declared') - Number(a.reading.level === 'declared'));
    const readings = [];
    for (const one of established) {
        if (readings.some(reading => reading.subject_qid === one.subject.qid)) continue;
        readings.push({subject_qid: one.subject.qid, stance: one.reading.stance, level: one.reading.level, found: String(one.passage.sentence).replace(/\s+/g, ' ').slice(0, 400)});
    }
    return {check: readings.length > 0 ? 'says' : 'unclear', readings};
};
