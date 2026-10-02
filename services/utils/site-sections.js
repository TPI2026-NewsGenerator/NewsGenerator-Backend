//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: site-sections.js
//  Description: The sections of a news site that match a subject, read from the links of its pages
//

"use strict"

import {parseHTML} from 'linkedom';
import {Filter} from './filter.js';
import {toDate} from './dates.js';
import {hostOf, nameOf} from './public-url.js';

// A general medium publishes on everything: its main feed carries a few rugby news among a hundred
// others. The feed worth adding is the one of its section, and the sections are linked from its
// home page ("/rugby/", "/gastronomie/", "/animaux/"), with their feed declared in their own page.
const MAX_PAGE_CHARS = 2_000_000;
const MIN_WORD = 4;                 // "match" or "chefs" can name a section, "de" or "la" can't
const MAX_DEPTH = 3;                // "/sport/rugby/" is a section, "/sport/rugby/2026/09/24/title" an article
const MAX_SLUG_WORDS = 4;           // "/toulon-bat-vannes-au-bout-du-suspense" is an article, not a section

// words that name no section, whatever the subject
const COMMON = new Set(['news', 'nouvelles', 'nouvelle', 'actualite', 'actualites', 'latest', 'dernieres', 'with', 'avec', 'pour', 'dans', 'from']);

const tokens = (text) => Filter.withoutAccents(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// the words of a subject given as keywords: 'Top 14, "Six Nations", IA' -> ['top', 'six', 'nations', 'ia']
// short words are kept only when they are an acronym, a section can be called "/ia/"
export const subjectWords = (keywords) => {
    const {groups} = Filter.parse(keywords);
    const words = groups.flat().flatMap(({text}) => text.length <= 3 && text === text.toUpperCase() && text !== text.toLowerCase()
        ? [text.toLowerCase()]
        : tokens(text).filter(word => word.length >= MIN_WORD));

    return [...new Set(words)].filter(word => !COMMON.has(word));
};

const anchors = (html, pageUrl) => {
    const {document} = parseHTML(html.slice(0, MAX_PAGE_CHARS));

    return [...document.querySelectorAll('a[href]')].map(anchor => {
        try {
            const url = new URL(anchor.getAttribute('href'), pageUrl);
            url.hash = '';
            return {url, text: anchor.textContent ?? ''};
        } catch {
            return null;
        }
    }).filter(link => link && (link.url.protocol === 'https:' || link.url.protocol === 'http:'));
};

// a word names a segment when it is one of its words, or starts it ("chien" -> "chiens")
const names = (words, segmentTokens) => segmentTokens.some(token => words.some(word => token === word || (word.length >= MIN_WORD && token.startsWith(word))));

// an address or a text naming one of the words: "/Rugby/Actualites/" names ['rugby']
export const namesSubject = (words, text) => words.length > 0 && names(words, tokens(text));

// pages of the same medium whose address or link text names the subject, the shallowest first
export const sectionLinks = (html, pageUrl, words, limit = 3) => {
    if (words.length === 0) return [];
    const medium = nameOf(hostOf(pageUrl) ?? '');
    const found = new Map();

    for (const {url, text} of anchors(html, pageUrl)) {
        if (nameOf(hostOf(url.href) ?? '') !== medium) continue;

        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 0 || segments.length > MAX_DEPTH) continue;
        if (tokens(segments.at(-1)).length > MAX_SLUG_WORDS) continue;

        const textTokens = tokens(text);
        const inPath = segments.some(segment => names(words, tokens(segment)));
        const inText = textTokens.length > 0 && textTokens.length <= 3 && names(words, textTokens);
        if (!inPath && !inText) continue;

        url.search = '';
        if (!found.has(url.href)) found.set(url.href, segments.length - (inPath ? 1 : 0));
    }

    return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([url]) => url);
};

const MAX_JUDGED = 30;              // news of a feed read to know how much it is on a subject, the newest
const DAY_MS = 24 * 60 * 60 * 1000;

// The judge of a subject given as keywords: async (texts) -> [true, false...], true for a text
// matching them like a search would. A caller can give its own judge instead (by meaning, with
// embeddings), findFeeds and bridgeFeed only ask it which texts are on the subject.
export const keywordJudge = (keywords) => {
    const matches = Filter.matcher(Filter.parse(keywords));
    return matches ? async (texts) => texts.map(matches) : null;
};

// how much the news of a feed are on the subject: {onSubject, judged, onSubjectPerDay}. The newest are
// judged, and the days they cover make the flow: 100 news of one day and 25 of two months differ
export const subjectStats = async (items, judge) => {
    // a news without a date is judged last. new Date(null) would be 1970, a valid date that made
    // pages of scores and TV channels look like dated news
    const dated = items.map(item => ({item, date: toDate(item.pubDate)}));
    const newest = dated.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
        .slice(0, MAX_JUDGED);

    const verdicts = await judge(newest.map(({item}) => `${item.title ?? ''}. ${item.description ?? ''}`.slice(0, 500)));
    const onSubject = newest.filter((_, i) => verdicts[i]);

    const dates = newest.map(({date}) => date).filter(Boolean);
    const days = dates.length > 1 ? Math.max(1, (Math.max(...dates) - Math.min(...dates)) / DAY_MS) : 1;

    return {
        onSubject: onSubject.length,
        judged: newest.length,
        onSubjectPerDay: onSubject.length / days,
        sample: onSubject[0]?.item.title ?? null,
        // the titles judged on it, the newest first: the discovery has the AI read them (see confirmOnSubject)
        onSubjectTitles: onSubject.map(({item}) => item.title).filter(Boolean),
    };
};

const FEED_ADDRESS =/(\.xml|\.rss|\/rss|\/feeds?\b|\/atom|[?&]format=rss)/i;
const FEEDS_PAGE = /(\brss\b|\bflux\b|\bfeeds?\b)/i;

// the page listing the feeds of a site ("/rss/", "Flux RSS"), which is not a feed itself
export const feedsPageLink = (html, pageUrl) => {
    const medium = nameOf(hostOf(pageUrl) ?? '');

    const link = anchors(html, pageUrl).find(({url, text}) =>
        nameOf(hostOf(url.href) ?? '') === medium
        && (FEEDS_PAGE.test(text) || /\/(rss|flux-rss|feeds?)\/?$/i.test(url.pathname))
        && !/\.(xml|rss)$/i.test(url.pathname));

    return link?.url.href ?? null;
};

// the feeds a page links to, those naming the subject when words are given
export const feedLinks = (html, pageUrl, words = []) => [...new Set(anchors(html, pageUrl)
    .filter(({url}) => FEED_ADDRESS.test(url.pathname + url.search))
    .filter(({url, text}) => words.length === 0 || names(words, [...tokens(url.pathname), ...tokens(text)]))
    .map(({url}) => url.href))];
