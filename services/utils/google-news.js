//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: google-news.js
//  Description: Google News: the media a search names (the discovery of the sources), the news of
//               the searches of the interests (read like feeds by the ingestion), and the real
//               address of its articles, found only for the ones a briefing reads
//

"use strict"

import process from 'node:process';
import {Crawlers} from './crawlers.js';
import {Filter} from './filter.js';
import {toDate} from './dates.js';
import {hostOf, mediumOf} from './public-url.js';

// Google News indexes far more media than db/rss-links.js. Its article links go through a redirect
// that hides the real address. Every item names its publisher in clear with
// <source url="https://www.bbc.com">bbc.com</source>: that is what makes the discovery possible, and
// what gives a news read through Google News its real medium.
// Measured on the UEFA profile, 48 hours: its searches gave 676 news, 158 stories our feeds did not
// have and 91 more media on 22 of the stories they had.
const SEARCH_URL = 'https://news.google.com/rss/search';
const MAX_ITEMS = 100;      // Google News never returns more

// Google News answers in the language and the country it is asked for: without this it only ever
// names the English speaking media, whatever the keywords
const LOCALES = {
    en: {hl: 'en-US', gl: 'US', ceid: 'US:en'},
    fr: {hl: 'fr', gl: 'FR', ceid: 'FR:fr'},
    es: {hl: 'es', gl: 'ES', ceid: 'ES:es'},
    de: {hl: 'de', gl: 'DE', ceid: 'DE:de'},
    it: {hl: 'it', gl: 'IT', ceid: 'IT:it'},
};

// Google News is no official API: asked too often from one address it answers 429 or a captcha,
// and the discovery of every reader stops with it. So every request of the server to Google goes
// through one queue, never two closer than the interval, and the first sign of a block pauses them
// for an hour.
// Google limits the pages of the articles far sooner than the searches: measured on 30.09.2026, a
// 429 on the page of an article while the searches still answered. So a block of the pages pauses
// only the real addresses ('articles'); a block of a search pauses everything ('searches').
const INTERVAL_MS = () => Number(process.env.GOOGLE_NEWS_INTERVAL_MS) || 1000;
const PAGE_INTERVAL_MS = 1000;      // the page of an article: Google blocks them sooner than the searches
const PAUSE_MS = 60 * 60e3;
const TIMEOUT_MS = 10000;
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

export class GoogleBlocked extends Error {}

let queue = Promise.resolve();
let lastAt = 0;
const pausedUntil = {searches: 0, articles: 0};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// true while Google News can be asked for this kind of request: 'searches' or 'articles'
export const googleAvailable = (kind = 'searches') => Date.now() >= pausedUntil[kind];

const pause = (kind, why) => {
    const until = Date.now() + PAUSE_MS;
    pausedUntil.articles = until;
    if (kind === 'searches') pausedUntil.searches = until;
    console.error(`Google News: ${why}, no ${kind === 'searches' ? 'request' : 'article page'} for ${PAUSE_MS / 60e3} minutes`);
    return new GoogleBlocked(`Google News is paused (${why}).`);
};

// a 429, a 503 or a page of consent or captcha instead of what was asked
const isBlocked = (status, url = '') => status === 429 || status === 503 || /consent\.google\.|google\.[a-z.]+\/sorry\//.test(url);

// task run in the queue, after the others and the interval
const politely = (task, {kind = 'searches', interval = INTERVAL_MS()} = {}) => {
    const run = queue.then(async () => {
        if (!googleAvailable(kind)) throw new GoogleBlocked('Google News is paused after a block.');
        const wait = lastAt + interval - Date.now();
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
        return task();
    });
    queue = run.catch(() => {});
    return run;
};

// one feed of Google News through the queue, in the shape of Crawlers.Xml
const readFeed = (url) => politely(async () => {
    const [feed] = await Crawlers.Xml([{url}]);
    const status = Number(feed.error?.match(/HTTP (\d{3})/)?.[1]);
    if (isBlocked(status)) throw pause('searches', `HTTP ${status}`);
    return feed;
});

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

// the feed of a search, in a language: null when the keywords say nothing
export const searchUrl = (keywords, {days = null, language = 'en'} = {}) => {
    if (toQuery(keywords).trim() === '') return null;          // "when:2d" alone searches everything
    const query = toQuery(keywords, days);
    const locale = LOCALES[language] ?? LOCALES.en;
    return `${SEARCH_URL}?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
};

export const isGoogleNewsUrl = (url) => typeof url === 'string' && url.startsWith('https://news.google.com/');

// the language a feed of Google News was asked in, null for another address
export const languageOfSearch = (url) => {
    if (!isGoogleNewsUrl(url)) return null;
    try {
        const ceid = new URL(url).searchParams.get('ceid');
        return Object.entries(LOCALES).find(([, locale]) => locale.ceid === ceid)?.[0] ?? null;
    } catch {
        return null;
    }
};

// Google writes the publisher at the end of every title: "Week 3 referee assignments - Football Zebras"
export const withoutPublisher = (title, publisher) =>
    publisher && title.endsWith(` - ${publisher}`) ? title.slice(0, -publisher.length - 3).trim() : title;

// the news and the media Google News gives for these keywords, in one call
// news: [{title, url, site, name, publishedAt}], media: [{site, name, news}] the most present first
export const search = async (keywords, {days = null, language = 'en'} = {}) => {
    const url = searchUrl(keywords, {days, language});
    if (!url) return {news: [], media: []};

    const feed = await readFeed(url);
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

// Google News also names posts of social networks and videos ("Just like last year, restaurateurs
// ... | Via ANC 24/7" on facebook.com): no medium, and nothing the server can read. They are left out
// when read, and never count as a voice
const PLATFORMS = new Set(['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'threads.net', 'tiktok.com',
    'youtube.com', 'youtu.be', 'linkedin.com', 'reddit.com', 'pinterest.com', 'dailymotion.com']);
export const isPlatform = (url) => {
    const host = hostOf(url);
    return !host || PLATFORMS.has(mediumOf(host));
};

// Google News also answers a search with pages that are no news: the table of a league ("Fasofoot
// Ligue 1 Table: Football Scores, Results & Fixtures", "Ligue 1 Table - 2026/2027"), a live blog
// (skysports.com/football/live-blog/...), where to watch a match. The AI took them for news of the
// interest. Their title says it, or their address once decoded
const NOT_NEWS_TITLES = [
    /\b(table|standings|scores|results|fixtures)\b.*\b(table|standings|scores|results|fixtures)\b/i,
    /\b(table|standings|classement|clasificación|tabelle|classifica)\s*[-–|:]\s*(\d{4}|live)/i,
    /\b(live blog|live updates|live scores?|as it happened|en direct|minute par minute|liveticker|in diretta|en vivo|en directo)\b/i,
    /\b(how to (watch|stream|buy tickets)|where to watch|live stream(ing)?|tv channel|comment (regarder|suivre|obtenir des billets)|sur quelle chaîne|en streaming)\b/i,
];
const NOT_NEWS_PATHS = /\/(live-?blog|live-?table|live|liveticker|en-direct|direct|minute-par-minute|standings|classement|fixtures|results|scores|table|tables)(\/|\.[a-z]+$|$)/i;

// 'link' is the real address of the page, when known (never the one of Google News)
export const isNotNews = (title, link = null) => {
    if (NOT_NEWS_TITLES.some(pattern => pattern.test(title ?? ''))) return true;
    if (!link || isGoogleNewsUrl(link)) return false;
    try {
        return NOT_NEWS_PATHS.test(new URL(link).pathname);
    } catch {
        return false;
    }
};

// A page that comes back under the same title is no news either, whatever the feed: "Football : Ligue
// 1 McDonald's" of canalplus.com, 5 links of Google News between 00:44 and 04:54, a page of its section
// with no text to read, was a card of a briefing; so are "Mise au Point" of rts.ch and "LdN : les
// résultats de la soirée". The same article met through several feeds has the same title too (wsj.com,
// swissinfo.ch, 3 feeds each), but all within the hour: a story told only by such a title, of one
// medium, over hours, is left out
const REPEATS = 3;
const REPEATED_OVER_MS = 2 * 3600e3;
// members: [{medium, title, link, at}]
export const isRepeatedPage = (members) => {
    const media = new Set(members.map(article => article.medium));
    const titles = new Set(members.map(article => article.title));
    if (media.size !== 1 || titles.size !== 1 || new Set(members.map(article => article.link)).size < REPEATS) return false;
    const times = members.map(article => new Date(article.at).getTime()).filter(Number.isFinite);
    return times.length > 0 && Math.max(...times) - Math.min(...times) >= REPEATED_OVER_MS;
};

// Feeds of Google News read one after the other, in the shape of Crawlers.Xml: the title without
// its publisher, the publisher in 'source', no description (Google only gives a list of links).
// Once Google blocks, the feeds left are answered {skipped: true}: they are read next time.
export const readSearches = async (urls) => {
    const results = [];
    for (const url of urls) {
        try {
            const feed = await readFeed(url);
            results.push({...feed, items: feed.items.slice(0, MAX_ITEMS)
                .filter(item => item.link && item.source?.url && !isPlatform(item.source.url))
                .map(item => ({...item, title: withoutPublisher(item.title, item.source.name), description: '', thumbnail: null}))
                .filter(item => !isNotNews(item.title))});
        } catch (err) {
            if (!(err instanceof GoogleBlocked)) throw err;
            results.push({url, skipped: true, items: []});
        }
    }
    return results;
};

// ---- the real address of an article ------------------------------------------------------------
// As google-news-url-decoder does it (github.com/SSujitX/google-news-url-decoder): the page of the
// article on Google News holds a signature and a time, and one request to batchexecute gives the
// real addresses of several articles. Measured: 6 links of 6, 160 ms a page.

// "https://news.google.com/rss/articles/CBMi...?oc=5" -> "CBMi..."
export const articleIdOf = (link) => {
    try {
        const url = new URL(link);
        if (url.hostname !== 'news.google.com') return null;
        const parts = url.pathname.split('/');
        const at = parts.indexOf('articles');
        return at >= 0 && parts[at + 1] ? parts[at + 1] : null;
    } catch {
        return null;
    }
};

const signatureOf = async (id) => {
    for (const url of [`https://news.google.com/articles/${id}`, `https://news.google.com/rss/articles/${id}`]) {
        const res = await politely(() => fetch(url, {headers: {'User-Agent': BROWSER}, signal: AbortSignal.timeout(TIMEOUT_MS)}),
            {kind: 'articles', interval: PAGE_INTERVAL_MS});
        if (isBlocked(res.status, res.url)) throw pause('articles', `HTTP ${res.status} on ${new URL(res.url).host}`);
        if (!res.ok) continue;
        const html = await res.text();
        const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
        if (signature && timestamp) return {signature, timestamp};
    }
    return null;
};

// The answer of batchexecute: ")]}'" then the entries, each carrying back the number of its call
// (entry[6]): Google answers them in any order. The addresses in the order of the calls, null for
// the ones not answered or not a web address
export const parseBatchAnswer = (text, count) => {
    const urls = new Array(count).fill(null);
    const payload = text.split('\n\n')[1];
    if (!payload) return urls;
    for (const entry of JSON.parse(payload)) {
        if (entry[0] !== 'wrb.fr' || typeof entry[2] !== 'string') continue;
        const at = Number(entry[6]) - 1;
        const url = JSON.parse(entry[2])?.[1];
        if (at >= 0 && at < count && typeof url === 'string' && /^https?:\/\//.test(url)) urls[at] = url;
    }
    return urls;
};

const resolve = (articles) => politely(async () => {
    const request = [articles.map(({id, timestamp, signature}, i) => ['Fbv4je',
        `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${timestamp},"${signature}"]`,
        null, String(i + 1)])];
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': BROWSER},
        body: `f.req=${encodeURIComponent(JSON.stringify(request))}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (isBlocked(res.status, res.url)) throw pause('articles', `HTTP ${res.status} on batchexecute`);
    if (!res.ok) throw new Error(`batchexecute answered ${res.status}`);
    return parseBatchAnswer(await res.text(), articles.length);
}, {kind: 'articles', interval: PAGE_INTERVAL_MS});

// the real address of these links of Google News: Map link -> address, without the ones that could
// not be found. Never throws: a briefing reads what it can, the others stay unread
export const decodeLinks = async (links) => {
    const decoded = new Map();
    const signed = [];
    try {
        for (const link of links) {
            const id = articleIdOf(link);
            const signature = id && await signatureOf(id);
            if (signature) signed.push({link, id, ...signature});
        }
    } catch (err) {
        if (!(err instanceof GoogleBlocked)) console.error(`Google News: an article page failed (${err.message})`);
    }
    if (signed.length === 0) return decoded;

    try {
        (await resolve(signed)).forEach((url, i) => url && decoded.set(signed[i].link, url));
    } catch (err) {
        console.error(`Google News: the addresses were not found (${err.message})`);
    }
    return decoded;
};

// A story known only through Google News needs more than one voice there: a search also names
// spam sites written by machines ("Ligue des Champions : Le Guide Complet" on a garden center's
// domain) and pages that are no news. It is kept when at least 'minMedia' media tell it, or when
// one of them is a medium the server reads through a feed ('established').
// members: [{feed_url, medium}]
export const credibleStory = (members, established, minMedia = 2) => {
    if (members.some(article => !isGoogleNewsUrl(article.feed_url))) return true;
    const media = new Set(members.map(article => article.medium).filter(medium => medium && !PLATFORMS.has(medium)));
    return media.size >= minMedia || [...media].some(medium => established.has(medium));
};

// The feeds of Google News read for the interests: one per search the AI wrote for them ("fr:arbitrage
// football"), in the languages of the reader, on the window of the stories. The same search of two
// readers is one feed, read once. They never go in user_feeds: they say what their reader follows,
// and the sources recommended to the others are taken from there (see RecommendationService)
export const SEARCH_DAYS = 2;
export const interestSearchUrls = (searches, languages) => [...new Set(searches
    .map(search => String(search).match(/^([a-z]{2}):(.+)$/))
    .filter(match => match && languages.includes(match[1]))
    .map(([, language, query]) => searchUrl([query.trim()], {days: SEARCH_DAYS, language}))
    .filter(Boolean))];

// The stories the AI chooses from: the 'fromFeeds' best told by at least one feed, as before Google
// News was read (they may have gained media through it), then at most 'extra' told only through
// Google News, 'perMedium' at most from one medium. Measured on the UEFA profile, the stories of
// Google alone took 30 of the 40 places: their titles are made of the words of the interests
// ("UEFA Champions League live streams", "Classement Ligue des Champions | CANAL+ Madagascar",
// four ticket pages of one site), while the real news among them were few.
// stories: sorted the best first, each with its members [{feed_url, medium}] and its best one
export const pickCandidates = (stories, {fromFeeds, extra, perMedium}) => {
    const onlyGoogle = (story) => story.members.every(article => isGoogleNewsUrl(article.feed_url));
    const byMedium = new Map();
    const google = stories.filter(onlyGoogle).filter(story => {
        const count = byMedium.get(story.best.medium) ?? 0;
        byMedium.set(story.best.medium, count + 1);
        return count < perMedium;
    }).slice(0, extra);
    const kept = new Set([...stories.filter(story => !onlyGoogle(story)).slice(0, fromFeeds), ...google]);
    return stories.filter(story => kept.has(story));
};
