//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: google-news.js
//  Description: Google News read to see what a search misses: the news of the media that are not
//               in the sources, and which media to add to stop missing them
//

"use strict"

import {Crawlers} from './crawlers.js';
import {Filter} from './filter.js';
import {toDate} from './dates.js';
import {hostOf} from './public-url.js';

// Google News indexes far more media than db/rss-links.js. Its article links go through a redirect
// that hides the real address, so its news can be read by the user in their browser but never
// scraped or summarized by the server. Every item names its publisher in clear with
// <source url="https://www.bbc.com">bbc.com</source>: that is what makes the discovery possible.
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

// Google writes the publisher at the end of every title: "Week 3 referee assignments - Football Zebras"
const withoutPublisher = (title, publisher) =>
    title.endsWith(` - ${publisher}`) ? title.slice(0, -publisher.length - 3).trim() : title;

// the news and the media Google News gives for these keywords, in one call
// news: [{title, url, site, name, publishedAt}], media: [{site, name, news}] the most present first
export const search = async (keywords, {days = null} = {}) => {
    const query = toQuery(keywords, days);
    if (query.trim() === '') return {news: [], media: []};

    const url = `${FEED_URL}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const [feed] = await Crawlers.Xml([{url}]);

    if (feed.error) {
        const error = new Error(`Google News did not answer (${feed.error})`);
        error.status = 502;
        throw error;
    }

    const news = [];
    const media = new Map();

    for (let item of feed.items.slice(0, MAX_ITEMS)) {
        const site = hostOf(item.source?.url);
        if (!site || !item.link) continue;

        const name = item.source.name || site;
        news.push({
            title: withoutPublisher(item.title, name),
            url: item.link,             // a Google redirect: the browser follows it, the server can't
            site: site,
            name: name,
            publishedAt: toDate(item.pubDate)?.toISOString() ?? null,
        });

        const medium = media.get(site) ?? {site, name, news: 0};
        medium.news++;
        media.set(site, medium);
    }

    return {news, media: [...media.values()].sort((a, b) => b.news - a.news)};
};
