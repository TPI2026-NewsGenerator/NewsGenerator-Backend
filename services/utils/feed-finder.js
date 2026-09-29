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
import {assertPublicUrl, fetchPublicUrl, hostOf, isBridgeUrl, nameOf} from './public-url.js';
import {feedLinks, feedsPageLink, keywordJudge, sectionLinks, subjectStats, subjectWords} from './site-sections.js';
import {feedLanguage} from './language.js';

// paths tried when the page declares no feed
const COMMON_PATHS = [
    '/rss', '/rss.xml', '/feed', '/feed.xml', '/feeds', '/atom.xml', '/index.xml',
    '/rss/news', '/news/rss', '/feeds/rss', '/rss/index.xml',
];
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';
const MAX_PAGE_CHARS = 2_000_000;
const MAX_SECTIONS = 3;         // section pages read for a subject
const MAX_CHECKED = 20;         // feeds read to choose one: each is a request
const MIN_ON_SUBJECT = 2;       // one news on the subject in a whole feed is chance, not a section
// Without a subject, the feed with the most news of these days: rts.ch declares no news feed on its
// home, and the one with the most items was a list of 100 old files (the newest three weeks old)
const RECENT_DAYS = 7;
const DAY_MS = 24 * 3600e3;

// the feed of the comments a WordPress site declares next to its news: justarsenal.com/comments/feed
// was chosen for "VAR decisions in the Champions League", readers answering each other
export const isCommentsFeed = (url) => /\/comments\/feed\/?$|[?&]feed=comments-rss2?\b/i.test(url);

// feeds declared in the page: <link rel="alternate" type="application/rss+xml" href="...">, the
// comments aside. The page is given back too: its links name the sections of the site
const readPage = async (siteUrl) => {
    const {res, url} = await fetchPublicUrl(siteUrl, {headers: {'User-Agent': USER_AGENT}});
    if (!res.ok) return {feeds: [], html: '', url};

    const body = (await res.text()).slice(0, MAX_PAGE_CHARS);

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

// keep only the candidates that really answer with news. With a judge of the subject (see
// keywordJudge), each feed also says how much it is on it (see subjectStats)
const checkFeeds = async (urls, judge = null) => {
    const publicUrls = [];
    for (let url of urls) {
        try {
            publicUrls.push((await assertPublicUrl(url)).href);
        } catch {
            // a feed of a private address is ignored
        }
    }

    const results = (await Crawlers.Xml(publicUrls.map(url => ({url}))))
        .map(result => ({...result, items: result.items.filter(item => item.link)}))
        .filter(result => result.items.length > 0);

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
            language: feedLanguage(items.map(item => `${item.title ?? ''} ${item.description ?? ''}`)),
            ...(stats ? {onSubject: stats.onSubject, judged: stats.judged, onSubjectPerDay: stats.onSubjectPerDay} : {}),
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

// feeds of a site, the best first. Without a subject the best is the one with the most news. With a
// subject (keywords, as a search writes them) it is the one most on it: the rugby section of a
// newspaper rather than its main feed, where rugby is 3 news out of 100. The keywords also name the
// sections to look for; which news are on the subject is decided by 'judge' when one is given (by
// meaning, see subjectStats), else by the keywords themselves. With 'languages' (those of the reader)
// a feed written in another is no candidate: favorflav.com, found by a French search, gave its Dutch
// section, on the subject by meaning (the vectors read every language) but not readable
export const findFeeds = async (site, {language = null, subject = null, judge = null, languages = null} = {}) => {
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
    }

    const host = hostOf(siteUrl);
    const words = subject ? subjectWords(subject) : [];
    const judgeSubject = judge ?? (subject ? keywordJudge(subject) : null);

    let candidates = home.feeds.length > 0 ? home.feeds : COMMON_PATHS.map(path => new URL(path, siteUrl).href);
    if (judgeSubject) {
        candidates = [...new Set([...candidates, ...await subjectCandidates(home, words, host)])].slice(0, MAX_CHECKED);
    }

    const best = (a, b) => (judgeSubject ? subjectScore(b) - subjectScore(a) : (b.recent ?? 0) - (a.recent ?? 0)) || b.items - a.items;
    // a feed whose language can't be told is kept: its titles may be too short to tell it
    const readable = (feed) => !languages || !feed.language || languages.includes(feed.language);
    const feeds = (await checkFeeds(candidates, judgeSubject)).filter(readable).sort(best);

    if (feeds.length > 0 && (!judgeSubject || isOnSubject(feeds[0]))) return feeds;
    if (!host) return feeds;

    // the site declares no feed and has none on a usual path, but it may still publish one that
    // readers know (already asked when there is a subject). Only the feeds of this same medium count
    if (!judgeSubject) {
        const fromDirectory = (await checkFeeds(await directoryFeeds(host))).filter(readable).sort(best);
        if (fromDirectory.length > 0) return fromDirectory;
    }

    // last resort: nothing published anywhere, or nothing on the subject. The site is read as a page
    // and turned into a feed, of its section on the subject when it has one. This one is built, not
    // published, so it breaks the day the site changes its pages
    const built = await bridgeFeed(siteUrl, {language, words, judge: judgeSubject});
    if (!built || !readable(built)) return feeds;

    // a built feed off the subject is worth less than a published one off it
    if (judgeSubject && !isOnSubject(built) && feeds.length > 0) return feeds;

    return [built, ...feeds];
};
