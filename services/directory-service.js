//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: directory-service.js
//  Description: The directory of the project, grown by the server itself: the media Google News
//               names that no feed of ours reads, and the sections of the media already read that
//               bring what their feeds miss. Every search of their language reads them
//

"use strict"

import process from 'node:process';
import {rss} from "../db/rss-links.js";
import {DirectoryModel} from "../models/directory-model.js";
import {findFeeds, readFeeds, siteFeeds} from "./utils/feed-finder.js";
import {isGoogleNewsUrl, isPlatform} from "./utils/google-news.js";
import {feedLanguage, LANGUAGES} from "./utils/language.js";
import {fetchPublicUrl, isBridgeUrl, readText} from "./utils/public-url.js";
import {looksPrivate, MAX_FEED_ITEMS} from "./utils/feed-limits.js";
import {mapWithConcurrency} from "./utils/concurrency.js";
import {toDate} from "./utils/dates.js";

// Measured against Google News (bench/vs-google.mjs, 15 searches of 7 days): 76% of its first 30
// news were in no feed of ours. A third came from media we read, through a section their feeds miss
// (the health of nbcnews.com, the missions of nasa.gov), two thirds from media we don't read. The
// searches of the profiles named 2546 media in 30 days, 577 of them 3 times or more. The sentences a
// search asks Google News name more: medicaldaily.com came from "measles outbreaks".
const DAYS = 30;
const MIN_NAMED = 3;                // named fewer times, a medium is often a page of guides or of spam
const RETRY_DAYS = 30;              // a site without a feed stays without one for a while
const RECENT_DAYS = 7;
const MIN_RECENT = 3;               // news of these days: under this the feed is asleep
// A section is kept when most of its recent news are news our feeds miss: the feed "all the news" of
// a medium read through its main feed brings its news twice, and nothing else
const MIN_NEW_SHARE = 0.5;
const MAX_SECTIONS = 2;             // per medium: each one is read every 20 minutes
// a feed holding more news at once is a flood or an archive (see feed-limits.js). Only the feeds the
// directory chooses for everyone are refused for it: a reader keeps a feed they add themselves
const MAX_ITEMS = MAX_FEED_ITEMS;
const MAX_CANDIDATES = 20;          // feeds of a site read to choose its sections, each is a request
const CONCURRENCY = 3;
// per run of the ingestion, so it never waits on hundreds of sites (the first time, see
// scripts/grow-directory.js)
const PER_RUN = Number(process.env.DIRECTORY_PER_RUN) || 10;
const ENABLED = () => process.env.DIRECTORY !== 'off';

// the category a section of a medium goes to, read in its address: "/health/" is science, "/sport/"
// sport. Else none, read by a search of any category: "latest.xml" of foxnews.com, a medium read
// through its sport feeds, is no sport
const SECTION_CATEGORIES = [
    ['sport', /sport|football|soccer|rugby|tennis|cricket|golf|basket|cycling|cyclisme|formula|motorsport/],
    ['technology', /tech|numerique|digital|gaming|jeux-video|video-games|gadgets/],
    ['science', /scien|health|sante|medic|space|espace|environ|climat|planet|nature/],
    ['economy', /business|econom|financ|money|market|bourse|entreprise|argent/],
    ['politics', /politi/],
    ['world', /world|monde|international|europe|afrique|africa|asia|americas|middle-east/],
];
export const sectionCategory = (url) => {
    let path;
    try {
        path = new URL(url).pathname.toLowerCase();
    } catch {
        return null;
    }
    return SECTION_CATEGORIES.find(([, words]) => words.test(path))?.[0] ?? null;
};

// "http://www.x.com/a/?utm=1#top" and "https://x.com/a" are one news
const normalized = (url) => {
    try {
        const {host, pathname} = new URL(url);
        return `${host.replace(/^www\./, '')}${pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch {
        return url;
    }
};

// feeds that are no feed of a medium for the directory: of Google News, of a platform, read through
// our bridge, or with a key in their address (api.foxsports.com gave its partnerKey)
const isOwnFeed = (url) => !isGoogleNewsUrl(url) && !isPlatform(url) && !isBridgeUrl(url) && !looksPrivate(url);

// A podcast or a channel of videos has no article to read: "les grosses têtes" of rtl.fr was taken
// for its main feed. Its episodes carry their sound (as scripts/import-awesome-feeds.js tells them)
const USER_AGENT = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';
const isPodcast = async (url) => {
    try {
        const {res} = await fetchPublicUrl(url, {headers: {'User-Agent': USER_AGENT}, timeoutMs: 15000});
        return /<itunes:|<enclosure[^>]+type="(audio|video)\//i.test(await readText(res));
    } catch {
        return false;
    }
};

// the recent news of a feed: [{link, date}]
const recentItems = (items) => items
    .map(item => ({link: item.link, date: toDate(item.pubDate)}))
    .filter(({date}) => date && Date.now() - date <= RECENT_DAYS * 24 * 3600e3);

// The sections worth adding among the feeds read ([{url, items}]), the best first: each one must bring
// MIN_RECENT recent news that 'known' (the addresses already read) misses, the most of its news. One
// taken, its news count as read for the next: two sections carrying the same news are not both taken
export const chooseSections = (allFeeds, known, max = MAX_SECTIONS) => {
    const feeds = allFeeds.filter(feed => feed.items.length <= MAX_ITEMS);
    const seen = new Set(known);
    const chosen = [];
    const recent = new Map(feeds.map(feed => [feed, recentItems(feed.items)]));

    while (chosen.length < max) {
        const scored = feeds
            .filter(feed => !chosen.includes(feed))
            .map(feed => {
                const items = recent.get(feed);
                const fresh = items.filter(({link}) => !seen.has(normalized(link))).length;
                return {feed, fresh, share: items.length ? fresh / items.length : 0};
            })
            .filter(({fresh, share}) => fresh >= MIN_RECENT && share >= MIN_NEW_SHARE)
            .sort((a, b) => b.fresh - a.fresh);
        if (scored.length === 0) break;

        const {feed} = scored[0];
        chosen.push(feed);
        recent.get(feed).forEach(({link}) => seen.add(normalized(link)));
    }
    return chosen;
};

// the language of a feed from its news, null when they can't tell it
const languageOfFeed = (feed) => feedLanguage(feed.items.map(item => `${item.title ?? ''} ${item.description ?? ''}`), feed.url);

// the media of db/rss-links.js: [{medium, language, urls}], the medium read in the news of each feed:
// the address of a feed does not always name it ("feeds.content.dowjones.io" is the WSJ)
const baseMedia = async () => {
    const feeds = Object.entries(rss).flatMap(([language, categories]) => Object.values(categories)
        .flatMap(urls => urls.filter(isOwnFeed).map(url => ({url, language}))));
    const mediumOfFeed = new Map((await DirectoryModel.mediaOfFeeds(feeds.map(feed => feed.url))).map(row => [row.url, row.medium]));

    const media = new Map();
    for (const {url, language} of feeds) {
        const medium = mediumOfFeed.get(url);
        if (!medium) continue;
        const known = media.get(medium) ?? {medium, language, urls: []};
        known.urls.push(url);
        media.set(medium, known);
    }
    return [...media.values()];
};

const sharedUrls = () => Object.values(rss).flatMap(categories => Object.values(categories).flat());

// A medium Google News names: its main feed, the one with the most news of these days, in no category
// (a newspaper named by a search on sport writes on everything). Only a feed it publishes, in one of
// our languages told by its own news: the bridge would load its page every 20 minutes, and the
// language of the search that named it is not the one of the medium (ua.news, named by an English one)
const tryNamed = async (medium) => {
    const feeds = (await findFeeds(medium.site ?? medium.medium, {languages: LANGUAGES, bridge: false}).catch(() => []))
        .filter(feed => isOwnFeed(feed.url) && feed.recent >= MIN_RECENT && LANGUAGES.includes(feed.language));
    for (const feed of feeds.filter(feed => feed.items <= MAX_ITEMS)) {
        if (await isPodcast(feed.url)) continue;
        return {kept: [{url: feed.url, medium: medium.medium, origin: 'named', language: feed.language, category: null}]};
    }
    const flood = feeds.find(feed => feed.items > MAX_ITEMS);
    return {kept: [], reason: flood ? `${flood.url} holds ${flood.items} news at once (over ${MAX_ITEMS})` : 'no feed of news of these days in one of our languages'};
};

// A medium already read: its sections that bring the news its feeds miss
const trySections = async (medium, readByUrl) => {
    const read = new Set(medium.urls.map(normalized));
    const candidates = (await siteFeeds(medium.medium).catch(() => []))
        .filter(url => isOwnFeed(url) && !read.has(normalized(url)) && !readByUrl.has(normalized(url)))
        .slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return {kept: [], reason: 'no other feed'};

    const [feeds, links] = await Promise.all([readFeeds(candidates), DirectoryModel.linksOf(medium.urls, DAYS)]);
    // a section in another language than ours is left out, not given the one of its medium: sections
    // in Arabic, Turkish or Albanian of media read in English had been taken for English
    const chosen = [];
    for (const feed of chooseSections(feeds, links.map(normalized))) {
        const language = languageOfFeed(feed);
        if (language && !LANGUAGES.includes(language)) continue;
        if (!await isPodcast(feed.url)) chosen.push({...feed, language});
    }
    if (chosen.length === 0) return {kept: [], reason: `${feeds.length} feeds, none brings what is missed`};

    return {kept: chosen.map(feed => ({
        url: feed.url, medium: medium.medium, origin: 'section',
        language: feed.language ?? medium.language,
        category: sectionCategory(feed.url),
    }))};
};

// every medium tried, each one noted with what it gave: [{medium, origin, kept, reason}]
const tryAll = async (media, origin, attempt, concurrency) => (await mapWithConcurrency(media, concurrency, async (medium) => {
    const {kept, reason = null} = await attempt(medium).catch(err => ({kept: [], reason: err.message}));
    if (kept.length > 0) await DirectoryModel.addFeeds(kept);
    await DirectoryModel.tried(medium.medium, origin, kept.length, kept.length ? null : reason);
    return {medium: medium.medium, origin, kept, reason};
})).map(result => result.value).filter(Boolean);

export const DirectoryService = {
    // A few more media looked at: 'named' media Google News names, 'sections' media already read,
    // 'concurrency' at a time. Answers what each gave
    grow: async ({named = PER_RUN, sections = PER_RUN, concurrency = CONCURRENCY} = {}) => {
        if (!ENABLED()) return [];

        const [media, directory] = await Promise.all([
            named > 0 ? DirectoryModel.namedMedia({sharedUrls: sharedUrls(), days: DAYS, minNews: MIN_NAMED, retryDays: RETRY_DAYS, limit: named}) : [],
            DirectoryModel.all(),
        ]);

        // the media of the directory read through their main feed have sections too
        const readMedia = await baseMedia();
        for (const feed of directory.filter(feed => feed.origin === 'named')) {
            if (!readMedia.some(medium => medium.medium === feed.medium)) {
                readMedia.push({medium: feed.medium, language: feed.language, urls: [feed.url]});
            }
        }
        for (const medium of readMedia) {
            medium.urls.push(...directory.filter(feed => feed.medium === medium.medium && feed.origin === 'section').map(feed => feed.url));
        }
        const tried = await DirectoryModel.triedSince(readMedia.map(medium => medium.medium), 'section', RETRY_DAYS);
        const sectionMedia = sections > 0 ? readMedia.filter(medium => !tried.has(medium.medium)).slice(0, sections) : [];
        const readByUrl = new Set(directory.map(feed => normalized(feed.url)));

        return [
            ...await tryAll(media, 'named', tryNamed, concurrency),
            ...await tryAll(sectionMedia, 'section', medium => trySections(medium, readByUrl), concurrency),
        ];
    },
};
