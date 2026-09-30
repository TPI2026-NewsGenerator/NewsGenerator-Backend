//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: import-awesome-feeds.js
//  Description: Proposes shared feeds for db/rss-links.js out of the lists of awesome-rss-feeds
//               (github.com/plenaryapp/awesome-rss-feeds, CC0): each feed is read once, kept only
//               when it answers, is alive and is written in one of our languages. It only prints
//               them: the ones chosen are copied into db/rss-links.js by hand, and a new run then
//               proposes only what is new in the lists
//
//  node --env-file=.env scripts/import-awesome-feeds.js
//

"use strict"

import fs from 'node:fs/promises';
import process from 'node:process';
import {XMLParser} from 'fast-xml-parser';
import {rss} from '../db/rss-links.js';
import {Parser} from '../services/utils/parser.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {isGoogleNewsUrl, isPlatform} from '../services/utils/google-news.js';
import {feedLanguage, LANGUAGES} from '../services/utils/language.js';
import {fetchPublicUrl, hostOf, mediumOf} from '../services/utils/public-url.js';
import {toDate} from '../services/utils/dates.js';

const REPO = 'https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master';
const LINKS = new URL('../db/rss-links.js', import.meta.url);

// their lists are by country (general news, no category) or by subject (mostly in English): the
// language a country list is expected in, the category of ours a list goes to. A feed is put under
// the language it is really written in (france24.com/en is in the list of France)
const LISTS = [
    {file: 'countries/with_category/France', language: 'fr', category: 'press'},
    {file: 'countries/with_category/Germany', language: 'de', category: 'press'},
    {file: 'countries/with_category/Spain', language: 'es', category: 'press'},
    {file: 'countries/with_category/Italy', language: 'it', category: 'press'},
    {file: 'countries/with_category/United Kingdom', language: 'en', category: 'press'},
    {file: 'countries/with_category/United States', language: 'en', category: 'press'},
    {file: 'countries/with_category/Canada', language: 'en', category: 'press'},
    {file: 'recommended/with_category/News', category: 'press'},
    {file: 'recommended/with_category/Sports', category: 'sport'},
    {file: 'recommended/with_category/Football', category: 'sport'},
    {file: 'recommended/with_category/Tennis', category: 'sport'},
    {file: 'recommended/with_category/Tech', category: 'technology'},
    {file: 'recommended/with_category/Gaming', category: 'technology'},
    {file: 'recommended/with_category/Science', category: 'science'},
    {file: 'recommended/with_category/Space', category: 'science'},
    {file: 'recommended/with_category/Business & Economy', category: 'economy'},
];

// alive but not wanted (30.09.2026): paid, people, tabloids, partisan, local or a country told in
// English. Never proposed again
const SET_ASIDE = new Set([
    'https://www.mediapart.fr/articles/feed',
    'https://www.dailymail.co.uk/home/index.rss',
    'http://feeds.foxnews.com/foxnews/latest',
    'http://feeds.feedburner.com/daily-express-news-showbiz',
    'https://ottawacitizen.com/feed/',
    'https://theprovince.com/feed/',
    'https://torontosun.com/category/news/feed',
    'https://feeds.thelocal.com/rss/es',
    'https://feeds.thelocal.com/rss/it',
    'https://www.theguardian.com/world/italy/rss',
    'https://www.euroweeklynews.com/feed/',
    'https://www.parisstaronline.com/feed',
    'http://feeds.feedburner.com/TheAncientGamingNoob',
]);

const MIN_ITEMS = 5;            // under this it is no feed of news
const MAX_AGE_DAYS = 30;        // its newest news older than this: the feed is dead
const CONCURRENCY = 10;
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';

// their lists also hold podcasts and channels of videos: nothing the server can read the text of
const isPodcast = (xml) => /<itunes:|<enclosure[^>]+type="(audio|video)\//i.test(xml);

// hosts that serve the feeds of many sites: a medium there is its address, not the host
const FEED_HOSTS = new Set(['feedburner.com']);
const mediumKey = (url) => {
    const medium = mediumOf(hostOf(url) ?? '');
    return FEED_HOSTS.has(medium) ? normalized(url) : medium;
};

// the feed read once, as the ingestion reads it, with its text to see what it is
const readFeed = async (url) => {
    try {
        const {res} = await fetchPublicUrl(url, {headers: {'User-Agent': USER_AGENT}, timeoutMs: 15000});
        if (!res.ok) return {error: `HTTP ${res.status}`};
        const xml = await res.text();
        return {items: await Parser.Xml(xml), podcast: isPodcast(xml)};
    } catch (err) {
        return {error: err.message};
    }
};

// "http://www.x.com/feed/" and "https://x.com/feed" are one feed
const normalized = (url) => url.trim().toLowerCase().replace(/^http:/, 'https:').replace('://www.', '://').replace(/\/+$/, '');

// every address written in db/rss-links.js, the ones in comment too (those were left out on
// purpose), and the ones set aside here
const knownUrls = async () => {
    const text = await fs.readFile(LINKS, 'utf8');
    return new Set([...[...text.matchAll(/"(https?:\/\/[^"]+)"/g)].map(([, url]) => url), ...SET_ASIDE].map(normalized));
};

// the media of each language and category already read
const knownMedia = () => new Set(Object.entries(rss).flatMap(([language, categories]) =>
    Object.entries(categories).flatMap(([category, urls]) => urls.map(url => `${language}/${category}/${mediumKey(url)}`))));

const readList = async ({file, language = null, category}) => {
    const res = await fetch(`${REPO}/${encodeURI(file)}.opml`, {signal: AbortSignal.timeout(15000)});
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const opml = new XMLParser({ignoreAttributes: false, attributeNamePrefix: ''}).parse(await res.text());
    const outlines = [];
    const walk = (node) => [node].flat().filter(Boolean).forEach(outline => {
        if (outline.xmlUrl) outlines.push({url: outline.xmlUrl, title: outline.title ?? outline.text ?? ''});
        walk(outline.outline);
    });
    walk(opml.opml?.body?.outline);
    return outlines.map(outline => ({...outline, list: file.split('/').pop(), expected: language, category}));
};

const candidates = (await Promise.all(LISTS.map(readList))).flat();
const known = await knownUrls();
const media = knownMedia();
const seen = new Set();
const fresh = candidates.filter(feed => {
    const key = normalized(feed.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
});

// the ones known, of Google News or of a platform are refused without being asked
const unread = (url) => known.has(normalized(url)) || isGoogleNewsUrl(url) || isPlatform(url);
const results = (await mapWithConcurrency(fresh, CONCURRENCY, ({url}) => unread(url) ? {} : readFeed(url)))
    .map(result => result.value);
const kept = [];
const refused = [];

fresh.forEach((feed, i) => {
    const {items = [], error, podcast} = results[i];
    const refuse = (why) => refused.push({...feed, why});
    if (known.has(normalized(feed.url))) return refuse('already in rss-links.js (maybe in comment)');
    if (isGoogleNewsUrl(feed.url)) return refuse('Google News: read through the searches of the profiles');
    if (isPlatform(feed.url)) return refuse('a social network or videos, no article to read');
    if (error) return refuse(error);
    if (podcast) return refuse('a podcast or videos, no article to read');
    if (items.length < MIN_ITEMS) return refuse(`${items.length} news only`);

    const newest = Math.max(...items.map(item => toDate(item.pubDate)?.getTime() ?? 0));
    const days = (Date.now() - newest) / 86400e3;
    if (!newest) return refuse('no date on its news');
    if (days > MAX_AGE_DAYS) return refuse(`newest news ${Math.round(days)} days old`);

    const language = feedLanguage(items.map(item => `${item.title ?? ''} ${item.description ?? ''}`));
    if (!language || !LANGUAGES.includes(language)) return refuse('language not one of ours');

    const medium = mediumOf(hostOf(feed.url) ?? '');
    if (media.has(`${language}/${feed.category}/${mediumKey(feed.url)}`)) return refuse(`${medium} already read in ${language}/${feed.category}`);
    media.add(`${language}/${feed.category}/${mediumKey(feed.url)}`);

    kept.push({...feed, language, medium, items: items.length, hours: Math.max(0, Math.round(days * 24))});
});

console.log(`${candidates.length} feeds in the lists, ${fresh.length} different, ${kept.length} kept, ${refused.length} refused\n`);
for (const feed of kept.sort((a, b) => `${a.language}${a.category}`.localeCompare(`${b.language}${b.category}`))) {
    console.log(`KEPT    ${feed.language}/${feed.category.padEnd(10)} ${feed.medium.padEnd(28)} ${String(feed.items).padStart(3)} news, newest ${feed.hours}h  ${feed.url}`);
}
console.log('');
for (const feed of refused) console.log(`REFUSED ${feed.list.padEnd(18)} ${feed.url}  (${feed.why})`);
process.exit(0);
