//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: find-feeds.js
//  Description: Find the RSS feeds of a website, to fill db/rss-links.js
//               usage: node scripts/find-feeds.js https://www.skysports.com [...other sites]
//

"use strict"

import process from 'node:process'
import {parseHTML} from 'linkedom';
import {Crawlers} from '../services/utils/crawlers.js';

// paths tried when the page declares no feed
const COMMON_PATHS = ['/rss', '/rss.xml', '/feed', '/feed.xml', '/feeds', '/atom.xml', '/index.xml'];
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';

// feeds declared in the <head> of the page: <link rel="alternate" type="application/rss+xml" href="...">
const declaredFeeds = async (siteUrl) => {
    const res = await fetch(siteUrl, { headers: {'User-Agent': USER_AGENT}, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { document } = parseHTML(await res.text());
    const links = [...document.querySelectorAll('link[rel="alternate"], link[rel="ALTERNATE"]')]
        .filter(link => /rss|atom|xml/i.test(link.getAttribute('type') ?? ''))
        .map(link => new URL(link.getAttribute('href'), siteUrl).href);

    return [...new Set(links)];
};

// a feed is kept only if it really gives news with a link
const checkFeeds = async (urls) => {
    const results = await Crawlers.Xml(urls.map(url => ({url})));

    return results.map(result => {
        const items = result.items.filter(item => item.link);
        const newest = result.items.map(item => new Date(item.pubDate)).filter(date => !isNaN(date)).sort((a, b) => b - a)[0];

        return {
            url: result.url,
            items: items.length,
            error: result.error,
            newest: newest ? `${Math.round((Date.now() - newest) / 3600e3)}h ago` : 'no date',
        };
    });
};

const findFeeds = async (site) => {
    const siteUrl = site.startsWith('http') ? site : `https://${site}`;
    console.log(`\n=== ${siteUrl}`);

    let candidates = [];
    try {
        candidates = await declaredFeeds(siteUrl);
        console.log(`declared in the page: ${candidates.length}`);
    } catch (err) {
        console.log(`page not readable (${err.message}), trying the usual paths`);
    }

    if (candidates.length === 0) {
        candidates = COMMON_PATHS.map(path => new URL(path, siteUrl).href);
    }

    for (let feed of await checkFeeds(candidates)) {
        if (feed.error) continue;   // not a feed or not reachable
        console.log(`  ${String(feed.items).padStart(3)} news, newest ${feed.newest.padEnd(9)} ${feed.url}`);
    }
};

const sites = process.argv.slice(2);
if (sites.length === 0) {
    console.log('usage: node scripts/find-feeds.js <site url> [...other sites]');
    process.exit(1);
}
for (let site of sites) await findFeeds(site);
