//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: google-news.js
//  Description: Google News used to discover which media publish on a subject, never to read their articles
//

"use strict"

import {Crawlers} from './crawlers.js';
import {Filter} from './filter.js';
import {hostOf} from './public-url.js';

// Google News indexes far more media than db/rss-links.js. Its article links go through a redirect
// that hides the real address, but every item names its publisher in clear with
// <source url="https://www.bbc.com">bbc.com</source>. So the feed is read here only to know WHICH
// media cover a subject: their news are then read from their own RSS feed, like every other source.
const FEED_URL = 'https://news.google.com/rss/search';
const MAX_ITEMS = 100;      // Google News never returns more

// our keywords (see Filter.parse) written with the Google operators: alternatives with OR, the terms
// of an alternative one after the other (AND), "quotes" and -excluded mean the same thing there
export const toQuery = (keywords, days) => {
    const {groups, excluded} = Filter.parse(keywords);
    const quote = ({text, exact}) => exact || /\s/.test(text) ? `"${text}"` : text;

    const alternatives = groups.map(terms => terms.map(quote).join(' '));
    const query = [
        alternatives.length > 1 ? alternatives.map(terms => `(${terms})`).join(' OR ') : alternatives[0] ?? '',
        ...excluded.map(term => `-${quote(term)}`),
    ].filter(Boolean).join(' ');

    return days ? `${query} when:${Math.ceil(days)}d` : query;
};

// media publishing on this subject: [{site, name, news}], the one publishing the most first
export const mediaFor = async (keywords, {days = null} = {}) => {
    const query = toQuery(keywords, days);
    if (query.trim() === '') return [];

    const url = `${FEED_URL}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const [feed] = await Crawlers.Xml([{url}]);

    if (feed.error) {
        const error = new Error(`Google News did not answer (${feed.error})`);
        error.status = 502;
        throw error;
    }

    const media = new Map();
    for (let news of feed.items.slice(0, MAX_ITEMS)) {
        const site = hostOf(news.source?.url);
        if (!site) continue;

        const medium = media.get(site) ?? {site, name: news.source.name || site, news: 0};
        medium.news++;
        media.set(site, medium);
    }

    return [...media.values()].sort((a, b) => b.news - a.news);
};
