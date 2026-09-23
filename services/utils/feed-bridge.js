//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: feed-bridge.js
//  Description: Builds a feed out of a site that publishes none, through the RSS-Bridge of the project
//

"use strict"

import process from 'node:process'
import {parseHTML} from 'linkedom';
import {Crawlers} from './crawlers.js';
import {fetchPublicUrl, isBridgeUrl} from './public-url.js';

// Some news sites have no feed at all (goal.com, onefootball.com). RSS-Bridge reads their page and
// gives back its articles. The address of the instance is configuration, never something a user
// typed: without it the project simply has no bridge and those sites stay out of reach.
const BRIDGE_URL = () => process.env.RSS_BRIDGE_URL ?? '';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const MAX_PAGE_CHARS = 2_000_000;
const ITEMS = 15;                   // articles asked per feed: the bridge reads one page for each
const MIN_LINKS = 5;                // a prefix shared by less links than this is not a list of articles
const MIN_ITEMS = 3;                // under this the feed is not worth a scraper that will break
const MIN_TITLE = 12;               // "Home", "Menu": a real headline is longer
const MIN_DATED = 0.5;              // a page of news carries a date, a page of team or contact does not
const MAX_TRIES = 3;                // patterns tried before giving up on a site

// the sections where a site files its articles, in the languages it may answer in
const NEWS_WORDS = /\/(news|article|story|stories|post|meldungen|noticias|notizie|actualites|nouvelles|nachrichten)/i;

// The articles of a list page share the start of their address: on goal.com they all begin with
// "/en/news/", on onefootball.com too, on realmadrid.com with "/en-US/news/". These prefixes are
// the candidates given to the bridge, the most likely first.
//
// The count alone is not enough: the English page of goal.com carries more links to "/en/team/"
// than to "/en/news/", and a feed of team pages is not news. So a prefix naming a section of
// articles comes first, then one in the language wanted, then the most frequent.
export const articlePatterns = (html, {language = null} = {}) => {
    const {document} = parseHTML(html.slice(0, MAX_PAGE_CHARS));
    const counts = new Map();

    for (const anchor of document.querySelectorAll('a[href]')) {
        const href = (anchor.getAttribute('href') ?? '').replace(/^https?:\/\/[^/]+/, '');
        const parts = href.split('/').filter(Boolean);
        if (parts.length < 2) continue;         // a section, not an article

        const prefix = '/' + parts.slice(0, parts.length > 2 ? 2 : 1).join('/') + '/';
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }

    const news = (prefix) => NEWS_WORDS.test(prefix);
    const spoken = (prefix) => Boolean(language) && new RegExp(`/${language}([-_][a-z]{2})?/`, 'i').test(prefix);

    // "/en/" is the root of a language, not a section of articles: everything of the site is under
    // it, contact pages included. A section is named, or it is deeper than the language.
    const section = (prefix) => NEWS_WORDS.test(prefix) || prefix.split('/').filter(Boolean).length >= 2;

    return [...counts.entries()]
        .filter(([prefix, links]) => links >= MIN_LINKS && section(prefix))
        .sort((a, b) => (news(b[0]) - news(a[0])) || (spoken(b[0]) - spoken(a[0])) || (b[1] - a[1]))
        .map(([prefix]) => prefix);
};

const bridgeFeedUrl = (page, pattern) => `${BRIDGE_URL().replace(/\/$/, '')}/?` + new URLSearchParams({
    action: 'display',
    bridge: 'CssSelectorBridge',
    format: 'Atom',
    limit: String(ITEMS),
    home_page: page,
    url_selector: `a[href*="${pattern}"]`,
    // without it the bridge answers links only, with no title and no date: the articles would be
    // invisible to a search, which reads the title and the description
    content_selector: 'article',
});

// Feed built from the page of a site, null when there is no bridge, when the site refuses to be
// read, or when what comes back does not look like articles. Same shape as findFeeds.
export const bridgeFeed = async (siteUrl, {language = null} = {}) => {
    if (!BRIDGE_URL() || isBridgeUrl(siteUrl)) return null;

    const read = async (page) => {
        try {
            // the address of the site is checked here, so the bridge is only ever sent a public one
            const {res} = await fetchPublicUrl(page, {headers: {'User-Agent': BROWSER}});
            if (!res.ok) return [];             // 401 and 403: the site refuses robots, nothing to do

            return articlePatterns(await res.text(), {language});
        } catch {
            return [];
        }
    };

    const speaks = (pattern) => !language || pattern.toLowerCase().includes(`/${language.toLowerCase()}`);

    let page = siteUrl;
    let patterns = await read(page);

    // a site answers in the language of the visitor: from here goal.com serves its German home, and
    // its English articles are linked nowhere on it. The section of the wanted language is tried too.
    if (language && !patterns.some(speaks)) {
        const translated = new URL(`/${language}/`, siteUrl).href;
        const found = await read(translated);

        if (found.some(speaks)) {
            page = translated;
            patterns = found;
        }
    }

    for (const pattern of patterns.slice(0, MAX_TRIES)) {
        const [feed] = await Crawlers.Xml([{url: bridgeFeedUrl(page, pattern)}]);
        if (feed.error) continue;

        // a wrong selector does not fail, it answers team pages and contact forms. Those have no
        // headline and no date, where an article has both, so they are refused here instead of
        // quietly filling the cache with rubbish.
        const articles = feed.items.filter(item => item.link && item.title?.trim().length >= MIN_TITLE);
        const dates = articles.map(item => new Date(item.pubDate)).filter(date => !isNaN(date));

        if (articles.length < MIN_ITEMS || dates.length < articles.length * MIN_DATED) continue;

        return {
            url: feed.url,
            items: articles.length,
            newest: dates.sort((a, b) => b - a)[0] ?? null,
            titles: articles.slice(0, 3).map(item => item.title),
            pattern: pattern,           // shown to the user: this feed is built, not published
        };
    }

    return null;
};
