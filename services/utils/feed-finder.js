//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-finder.js
//  Description: Finds the RSS feeds of a website, from the site address given by a user
//

"use strict"

import {parseHTML} from 'linkedom';
import {Crawlers} from './crawlers.js';
import {searchDirectory} from './feed-directory.js';
import {assertPublicUrl, fetchPublicUrl, hostOf, nameOf} from './public-url.js';

// paths tried when the page declares no feed
const COMMON_PATHS = [
    '/rss', '/rss.xml', '/feed', '/feed.xml', '/feeds', '/atom.xml', '/index.xml',
    '/rss/news', '/news/rss', '/feeds/rss', '/rss/index.xml',
];
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';
const MAX_PAGE_CHARS = 2_000_000;

// feeds declared in the page: <link rel="alternate" type="application/rss+xml" href="...">
const declaredFeeds = async (siteUrl) => {
    const {res, url} = await fetchPublicUrl(siteUrl, {headers: {'User-Agent': USER_AGENT}});
    if (!res.ok) return [];

    const body = (await res.text()).slice(0, MAX_PAGE_CHARS);

    // the address given is the feed itself
    if (/^\s*<(\?xml|rss|feed|rdf:RDF)/i.test(body)) return [url];

    const {document} = parseHTML(body);
    const links = [...document.querySelectorAll('link[rel="alternate" i]')]
        .filter(link => /rss|atom|xml/i.test(link.getAttribute('type') ?? ''))
        .map(link => {
            try {
                return new URL(link.getAttribute('href'), url).href;
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    return [...new Set(links)];
};

// keep only the candidates that really answer with news
const checkFeeds = async (urls) => {
    const publicUrls = [];
    for (let url of urls) {
        try {
            publicUrls.push((await assertPublicUrl(url)).href);
        } catch {
            // a feed of a private address is ignored
        }
    }

    const results = await Crawlers.Xml(publicUrls.map(url => ({url})));

    return results
        .map(result => {
            const items = result.items.filter(item => item.link);
            const dates = result.items.map(item => new Date(item.pubDate)).filter(date => !isNaN(date));

            return {
                url: result.url,
                items: items.length,
                newest: dates.sort((a, b) => b - a)[0] ?? null,
                titles: items.slice(0, 3).map(item => item.title),
            };
        })
        .filter(feed => feed.items > 0);
};

// feeds of a site, the best first (the one with the most news)
export const findFeeds = async (site) => {
    // "fortune.com" -> https, but "file:///etc/passwd" keeps its protocol so it is refused as such
    const value = site.trim();
    const siteUrl = value.includes('://') ? value : `https://${value}`;

    let candidates = [];
    try {
        candidates = await declaredFeeds(siteUrl);
    } catch (err) {
        if (err.status === 400) throw err;      // private address, bad protocol: the user must know
    }

    if (candidates.length === 0) {
        candidates = COMMON_PATHS.map(path => new URL(path, siteUrl).href);
    }

    const feeds = (await checkFeeds(candidates)).sort((a, b) => b.items - a.items);
    if (feeds.length > 0) return feeds;

    // last resort: the site declares no feed and has none on a usual path, but it may still publish
    // one that readers know. Only the feeds of this same medium are kept, a search for "uefa.com"
    // also answers with the sites that write about it
    const host = hostOf(siteUrl);
    if (!host) return [];

    const fromDirectory = (await searchDirectory(host, 10))
        .filter(feed => nameOf(hostOf(feed.url) ?? '') === nameOf(host))
        .map(feed => feed.url);

    return (await checkFeeds(fromDirectory)).sort((a, b) => b.items - a.items);
};
