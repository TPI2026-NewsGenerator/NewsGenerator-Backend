//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: feed-finder.js
//  Description: Finds the RSS feeds of a website, from the site address given by a user
//

"use strict"

import {parseHTML} from 'linkedom';
import {Crawlers} from './crawlers.js';
import {toDate} from './dates.js';
import {searchDirectory} from './feed-directory.js';
import {bridgeFeed} from './feed-bridge.js';
import {assertPublicUrl, discardBody, fetchPublicUrl, hostOf, isBridgeUrl, nameOf, readText} from './public-url.js';
import {feedLinks, feedsPageLink, keywordJudge, sectionLinks, subjectStats, subjectWords} from './site-sections.js';
import {feedLanguage} from './language.js';

// paths tried when the page declares no feed. The last two are the ones of two publishing systems
// many newspapers use and never declare: Arc (inquirer.com, washingtonpost.com) and the one of
// Reach (mirror.co.uk, nottinghampost.com). "/feed/" with its slash is the address WordPress gives its
// feed: ahoraeg.com and iraqinews.com refuse "/feed" with a 403 and answer "/feed/"
const COMMON_PATHS = [
    '/rss', '/rss.xml', '/feed', '/feed/', '/feed.xml', '/feeds', '/atom.xml', '/index.xml',
    '/rss/news', '/news/rss', '/feeds/rss', '/rss/index.xml',
    '/arc/outboundfeeds/rss/?outputType=xml', '/?service=rss',
];
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';
const MAX_PAGE_CHARS = 2_000_000;
const MAX_SECTIONS = 3;         // section pages read for a subject
const MAX_CHECKED = 20;         // feeds read to choose one: each is a request
const MIN_ON_SUBJECT = 2;       // one news on the subject in a whole feed is chance, not a section
// Without a subject, the feed with the most news of these days: rts.ch declares no news feed on its
// home, and the one with the most items was a list of 100 old files (the newest three weeks old)
const RECENT_DAYS = 7;
const MIN_RECENT = 3;           // news of those days: under this a feed is asleep (as in source-service.js)
const DAY_MS = 24 * 3600e3;

// the feed of the comments a WordPress site declares next to its news: justarsenal.com/comments/feed
// was chosen for "VAR decisions in the Champions League", readers answering each other
export const isCommentsFeed = (url) => /\/comments\/feed\/?$|[?&]feed=comments-rss2?\b/i.test(url);

// feeds declared in the page: <link rel="alternate" type="application/rss+xml" href="...">, the
// comments aside. The page is given back too: its links name the sections of the site
const readPage = async (siteUrl) => {
    const {res, url} = await fetchPublicUrl(siteUrl, {headers: {'User-Agent': USER_AGENT}});
    if (!res.ok) {
        await discardBody(res);
        return {feeds: [], html: '', url, dead: true};
    }

    const body = (await readText(res)).slice(0, MAX_PAGE_CHARS);

    // the address given is the feed itself
    if (/^\s*<(\?xml|rss|feed|rdf:RDF)/i.test(body)) return {feeds: [url], html: '', url};

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
        .filter(link => link && !isCommentsFeed(link));

    return {feeds: [...new Set(links)], html: body, url};
};

// a section that can't be read gives no feed, it is only one candidate among others
const tryPage = (url) => readPage(url).catch(() => ({feeds: [], html: '', url}));

// The news sitemaps of a site: the ones its robots.txt declares with "news" in their address, else the
// usual addresses, and in an index of sitemaps the ones named "news". Read as feeds (see Parser.Xml):
// 9 of 40 media the directory found without a feed publish one (bench/news-sitemaps.mjs)
const SITEMAP_PATHS = ['/news-sitemap.xml', '/sitemap_news.xml', '/sitemap-news.xml', '/news_sitemap.xml', '/sitemaps/news.xml', '/sitemap/news.xml'];
const MAX_SITEMAPS = 4;
const textOf = async (url) => {
    try {
        const {res} = await fetchPublicUrl(url, {headers: {'User-Agent': USER_AGENT}});
        if (!res.ok) {
            await discardBody(res);
            return '';
        }
        return (await readText(res)).slice(0, MAX_PAGE_CHARS);
    } catch {
        return '';
    }
};
export const newsSitemaps = async (siteUrl) => {
    const origin = new URL(siteUrl).origin;
    const robots = await textOf(`${origin}/robots.txt`);
    const declared = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(match => match[1]).filter(url => /news/i.test(url));
    const candidates = declared.length > 0 ? declared : SITEMAP_PATHS.map(path => origin + path);
    // Read together, not one after the other: 6 sites, 0.4 to 4.9 s one after the other, 0.15 to 1.0 s together
    // (2.11.2026). A site with no feed, most of a list, always went through all of them
    const texts = await Promise.all(candidates.slice(0, MAX_SITEMAPS + 2).map(async url => [url, await textOf(url)]));
    const found = [];
    for (const [url, xml] of texts) {
        if (/<news:news/i.test(xml)) found.push(url);
        // an index: the sitemaps of news it lists
        else if (/<sitemapindex/i.test(xml)) {
            found.push(...[...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(match => match[1]).filter(loc => /news/i.test(loc)).slice(0, 2));
        }
        if (found.length >= MAX_SITEMAPS) break;
    }
    return [...new Set(found)].slice(0, MAX_SITEMAPS);
};

// the candidates that answer with news, read: [{url, items}]. A feed of a private address is ignored
export const readFeeds = async (urls) => {
    const publicUrls = [];
    for (let url of urls) {
        try {
            publicUrls.push((await assertPublicUrl(url)).href);
        } catch {
            // a feed of a private address is ignored
        }
    }

    return (await Crawlers.Xml(publicUrls.map(url => ({url}))))
        .map(result => ({...result, items: result.items.filter(item => item.link)}))
        .filter(result => result.items.length > 0);
};

// keep only the candidates that really answer with news. With a judge of the subject (see
// keywordJudge), each feed also says how much it is on it (see subjectStats)
const checkFeeds = async (urls, judge = null) => {
    const results = await readFeeds(urls);

    return Promise.all(results.map(async ({url, items}) => {
        const dates = items.map(item => toDate(item.pubDate)).filter(Boolean);
        const stats = judge ? await subjectStats(items, judge) : null;

        return {
            url: url,
            items: items.length,
            recent: dates.filter(date => Date.now() - date <= RECENT_DAYS * DAY_MS).length,
            newest: dates.sort((a, b) => b - a)[0] ?? null,
            // the sample shown to the user is a news on the subject when there is one
            titles: [...new Set([stats?.sample, ...items.map(item => item.title)])].filter(Boolean).slice(0, 3),
            language: feedLanguage(items.map(item => `${item.title ?? ''} ${item.description ?? ''}`), url),
            ...(stats ? {onSubject: stats.onSubject, judged: stats.judged, onSubjectPerDay: stats.onSubjectPerDay,
                onSubjectTitles: stats.onSubjectTitles} : {}),
        };
    }));
};

// How much a feed brings on the subject: its news on it per day, times the share of its news on it.
// The flow alone would pick the main feed of a newspaper, where "chef" also finds "chef de l'Etat",
// and the share alone would pick a feed 100% on the subject that publishes once a month (the "Top
// Chef" feed of ladepeche.fr), or the women's rugby feed of a rugby site, whose main feed rarely
// writes "rugby" in its titles ("Top 14 - Toulon bat Vannes") but brings 16 news a day.
// A single news proves nothing: a regional feed must not win because one of its 20 news named a dog.
export const isOnSubject = (feed) => feed.onSubject >= MIN_ON_SUBJECT;
export const subjectScore = (feed) => isOnSubject(feed) ? feed.onSubjectPerDay * feed.onSubject / feed.judged : 0;

// the feeds of this same medium known to the directory: the ones a site declares nowhere, and often
// one per section. A search for "uefa.com" also answers with the sites that write about it
const directoryFeeds = async (host) => (await searchDirectory(host, 20))
    .filter(feed => nameOf(hostOf(feed.url) ?? '') === nameOf(host))
    .map(feed => feed.url);

// the feeds of a site that may be on the subject: those of its sections ("/rugby/"), of its page
// listing its feeds ("/rss/"), and those the directory knows
const subjectCandidates = async (home, words, host) => {
    const sections = sectionLinks(home.html, home.url, words, MAX_SECTIONS);
    const feedsPage = feedsPageLink(home.html, home.url);

    const [sectionPages, listing, known] = await Promise.all([
        Promise.all(sections.map(tryPage)),
        feedsPage ? tryPage(feedsPage) : null,
        host ? directoryFeeds(host) : [],
    ]);

    return [
        ...sectionPages.flatMap(page => page.feeds),
        ...(listing ? feedLinks(listing.html, listing.url, words) : []),
        ...known,
    ];
};

// every feed a site offers, none chosen: the ones its home page declares, the ones its page of feeds
// lists ("/rss/"), and the ones the directory knows. The sections of a medium already read are
// looked for among them (see directory-service.js)
export const siteFeeds = async (site) => {
    const siteUrl = site.includes('://') ? site : `https://${site}`;
    if (isBridgeUrl(siteUrl)) return [];

    const home = await tryPage(siteUrl);
    const feedsPage = feedsPageLink(home.html, home.url);
    const host = hostOf(siteUrl);
    const [listing, known] = await Promise.all([
        feedsPage ? tryPage(feedsPage) : null,
        host ? directoryFeeds(host).catch(() => []) : [],
    ]);

    return [...new Set([
        ...home.feeds,
        ...(listing ? [...listing.feeds, ...feedLinks(listing.html, listing.url)] : []),
        ...known,
    ])].filter(url => !isCommentsFeed(url));
};

// feeds of a site, the best first. Without a subject the best is the one with the most news. With a
// subject (keywords, as a search writes them) it is the one most on it: the rugby section of a
// newspaper rather than its main feed, where rugby is 3 news out of 100. The keywords also name the
// sections to look for; which news are on the subject is decided by 'judge' when one is given (by
// meaning, see subjectStats), else by the keywords themselves. With 'languages' a feed written in
// another is no candidate (the directory keeps the languages it can tell). 'known' are
// feeds of the site another directory knows (see media-cloud.js), candidates like the others. Without
// 'bridge', a site that publishes no feed gives none: the directory adds hundreds of media, and each
// one read through the bridge loads its page every time
export const findFeeds = async (site, {language = null, subject = null, judge = null, languages = null, known = [], bridge = true} = {}) => {
    // "fortune.com" -> https, but "file:///etc/passwd" keeps its protocol so it is refused as such
    const value = site.trim();
    const siteUrl = value.includes('://') ? value : `https://${value}`;

    // the bridge is ours and answers on this machine: a user naming it would have us fetch whatever
    // they put in its parameters
    if (isBridgeUrl(siteUrl)) {
        throw Object.assign(new Error('This address is not a website.'), {status: 400});
    }

    let home = {feeds: [], html: '', url: siteUrl};
    try {
        home = await readPage(siteUrl);
    } catch (err) {
        if (err.status === 400) throw err;      // private address, bad protocol: the user must know
        home.dead = true;
    }

    // A list names the feed of a site, and the feed died since or moved: 91 of the 855 addresses of a
    // list answered 404, 4 an error 500. The site itself often still has one (17 of them), or a page
    // to read (28): its root is tried instead, nothing of the dead page was to be read anyway
    const root = new URL(siteUrl).origin + '/';
    if (home.dead && siteUrl.replace(/\/?$/, '/') !== root) {
        return findFeeds(root, {language, subject, judge, languages, known, bridge});
    }

    // The bare domain refuses the page and www. serves it (enabbaladi.net answers 403 to the first, the
    // feed on the second): the site is read there when the www. page answers. When it is refused too
    // (iraqinews.com refuses both to us, and serves the feed of www.), the usual paths of both are tried
    let withWww = null;
    if (home.dead && !new URL(home.url).hostname.startsWith('www.')) {
        withWww = new URL(home.url);
        withWww.hostname = `www.${withWww.hostname}`;
        const answers = await readPage(withWww.href).then(page => !page.dead, () => false);
        if (answers) return findFeeds(withWww.href, {language, subject, judge, languages, known, bridge});
    }

    const host = hostOf(siteUrl);
    const words = subject ? subjectWords(subject) : [];
    const judgeSubject = judge ?? (subject ? keywordJudge(subject) : null);

    // The usual paths of the site where it lives: iraqinews.com sends its readers to www.iraqinews.com, and
    // only the second answers the feed (the first refuses it)
    const usualPaths = [home.url, withWww?.href].filter(Boolean)
        .flatMap(base => COMMON_PATHS.map(path => new URL(path, base).href));
    let candidates = home.feeds.length > 0 ? home.feeds : usualPaths;
    if (judgeSubject) {
        candidates = [...new Set([...candidates, ...await subjectCandidates(home, words, host), ...known])].slice(0, MAX_CHECKED);
    } else if (known.length > 0) {
        candidates = [...new Set([...candidates, ...known])].slice(0, MAX_CHECKED);
    }

    const best = (a, b) => (judgeSubject ? subjectScore(b) - subjectScore(a) : (b.recent ?? 0) - (a.recent ?? 0)) || b.items - a.items;
    // a feed whose language can't be told is kept: its titles may be too short to tell it
    const readable = (feed) => !languages || !feed.language || languages.includes(feed.language);
    let feeds = (await checkFeeds(candidates, judgeSubject)).filter(readable).sort(best);

    // the page declares feeds and none answers with news (cookislandsnews.com declares two that do not, and
    // serves its feed on /feed): the usual paths are tried as if it declared none
    if (feeds.length === 0 && home.feeds.length > 0) {
        const tried = new Set(candidates);
        feeds = (await checkFeeds(usualPaths.filter(url => !tried.has(url)), judgeSubject)).filter(readable).sort(best);
    }

    // the best feed found is asleep: sdna.gr declares an rss.xml with no news of the week, and has a latest.xml
    // with 20 that the directory knows. What else the site and the directory offer is read, the best of all wins
    if (!judgeSubject && feeds.length > 0 && (feeds[0].recent ?? 0) < MIN_RECENT) {
        const tried = new Set([...candidates, ...feeds.map(feed => feed.url)]);
        const others = [...usualPaths, ...(host ? await directoryFeeds(host).catch(() => []) : [])].filter(url => !tried.has(url));
        feeds = [...feeds, ...(await checkFeeds([...new Set(others)])).filter(readable)].sort(best);
    }

    if (feeds.length > 0 && (!judgeSubject || isOnSubject(feeds[0]))) return feeds;
    if (!host) return feeds;

    // the site declares no feed and has none on a usual path, but it may still publish one that
    // readers know (already asked when there is a subject). Only the feeds of this same medium count
    if (!judgeSubject) {
        const fromDirectory = (await checkFeeds(await directoryFeeds(host))).filter(readable).sort(best);
        if (fromDirectory.length > 0) return fromDirectory;
    }

    // its news sitemap, published for Google News: one request a read, as a feed, where the bridge
    // reads the pages of the site every time
    const sitemaps = (await checkFeeds(await newsSitemaps(siteUrl), judgeSubject)).filter(readable).sort(best);
    if (sitemaps.length > 0 && (!judgeSubject || isOnSubject(sitemaps[0]))) return [...sitemaps, ...feeds];

    if (!bridge) return feeds;

    // last resort: nothing published anywhere, or nothing on the subject. The site is read as a page
    // and turned into a feed, of its section on the subject when it has one. This one is built, not
    // published, so it breaks the day the site changes its pages
    const built = await bridgeFeed(siteUrl, {language, words, judge: judgeSubject});
    if (!built || !readable(built)) return feeds;

    // a built feed off the subject is worth less than a published one off it
    if (judgeSubject && !isOnSubject(built) && feeds.length > 0) return feeds;

    return [built, ...feeds];
};
