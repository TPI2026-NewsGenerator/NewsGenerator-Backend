//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: find-missing-sources.js
//  Description: Sweeps the media missing from db/rss-links.js and finds the feed of as many as
//               possible, offline: nobody waits, so it can try far more than a search does
//               usage: node scripts/find-missing-sources.js [--language en] [--days 3]
//                                                           [--candidates 40] [keyword ...]
//

"use strict"

import process from 'node:process'
import {rss} from '../db/rss-links.js';
import {search as googleNews} from '../services/utils/google-news.js';
import {mediaFor as gdeltMedia} from '../services/utils/gdelt.js';
import {findFeeds} from '../services/utils/feed-finder.js';
import {hostOf, nameOf} from '../services/utils/public-url.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {FeedModel} from '../models/feed-model.js';
import {prisma} from '../config/db.js';
import Links from '../services/utils/links.js';

// A search only tries the 8 media publishing the most, because the user is waiting. Here nothing
// waits: the media of every search are gathered first, then their feeds are looked for by batches.
// The two directories are used, and the four steps of findFeeds, RSS-Bridge included.
const CONCURRENCY = 4;
const BETWEEN_SEARCHES_MS = 1500;   // the directories dislike being hammered
const FRESH_DAYS = 30;
const GDELT_TIMEOUT_MS = 30000;     // it answers in 11 to 22 seconds, a search cannot wait that long
const GDELT_TRIES = 3;

const option = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? fallback : process.argv[at + 1];
};

const language = option('language', 'en');
const days = Number(option('days', 3));
const maxCandidates = Number(option('candidates', 40));
const FLAGS = ['--language', '--days', '--candidates'];
const keywords = process.argv.slice(2).filter((arg, i, args) => !arg.startsWith('--') && !FLAGS.includes(args[i - 1]));

if (!Links.languages().includes(language)) {
    console.log(`No source in "${language}". Available: ${Links.languages().join(', ')}`);
    process.exit(1);
}

// what the users actually search, plus what was asked on the command line
const searchesOfUsers = async () => {
    const saved = await prisma.custom_searches.findMany({
        where: {language},
        select: {keyword: true},
        distinct: ['keyword'],
    });
    return saved.map(row => row.keyword).filter(Boolean);
};

// the same rule as a search: the address of a feed does not always name its medium, the BBC writes
// on bbc.com and serves its feeds from feeds.bbci.co.uk, so the links of the cached articles are
// read too, or the sweep offers media that are already there
const knownMedia = async () => {
    const urls = Object.values(rss).flatMap(sources => Object.values(sources).flat());

    return new Set([
        ...urls.map(hostOf).filter(Boolean),
        ...await FeedModel.articleHosts(urls),
    ].map(nameOf));
};

const searches = [...new Set([...keywords, ...await searchesOfUsers()])];
if (searches.length === 0) {
    console.log('Nothing to sweep: no custom search saved in this language, and no keyword given.');
    console.log('usage: node scripts/find-missing-sources.js [--language en] [--days 3] [--candidates 40] "referee" ...');
    await prisma.$disconnect();
    process.exit(0);
}

console.log(`Sweeping ${searches.length} search(es) in ${language}, over ${days} day(s):`);
searches.forEach(keyword => console.log(`  - ${keyword}`));

// 1. every medium named by the two directories, for every search, counted over all of them
const known = await knownMedia();
const wanted = new Map();

for (const keyword of searches) {
    const [{media}, alsoFound] = await Promise.all([
        googleNews([keyword], {days, language}),
        gdeltMedia([keyword], {days, language, timeoutMs: GDELT_TIMEOUT_MS, tries: GDELT_TRIES}),
    ]);

    for (const medium of [...media, ...alsoFound]) {
        const name = nameOf(medium.site);
        if (known.has(name)) continue;

        const found = wanted.get(name) ?? {site: medium.site, name: medium.name, news: 0, searches: new Set()};
        found.news += medium.news;
        found.searches.add(keyword);
        wanted.set(name, found);
    }

    process.stdout.write(`  ${keyword}: ${media.length} media from Google News, ${alsoFound.length} from GDELT\n`);
    await new Promise(resolve => setTimeout(resolve, BETWEEN_SEARCHES_MS));
}

// a medium found by several searches matters more than one found by a single one
const candidates = [...wanted.values()]
    .sort((a, b) => (b.searches.size - a.searches.size) || (b.news - a.news))
    .slice(0, maxCandidates);

console.log(`\n${wanted.size} media missing, looking for the feed of the ${candidates.length} best...\n`);

// 2. the feed of each one, by the four steps of findFeeds
const results = await mapWithConcurrency(candidates, CONCURRENCY, medium => findFeeds(medium.site, {language}));

const found = [];
results.forEach((result, i) => {
    const medium = candidates[i];
    const feed = result.status === 'fulfilled' ? result.value[0] : null;

    if (!feed) {
        console.log('   -  ', medium.site.padEnd(28), result.status === 'rejected' ? String(result.reason.message).slice(0, 40) : 'no feed');
        return;
    }

    const fresh = !feed.newest || (Date.now() - new Date(feed.newest)) < FRESH_DAYS * 864e5;
    if (!fresh) {
        console.log('  old ', medium.site.padEnd(28), `newest ${Math.round((Date.now() - new Date(feed.newest)) / 864e5)}d old`);
        return;
    }

    console.log(feed.pattern ? ' BUILT' : ' FEED ', medium.site.padEnd(28),
        `${String(feed.items).padStart(3)} items`, `${medium.news} news over ${medium.searches.size} search(es)`);
    found.push({medium, feed});
});

// a feed a medium publishes belongs to the shared catalogue, one built from a page does not: it
// only answers while the RSS-Bridge container runs, and db/rss-links.js is read by everybody
const published = found.filter(({feed}) => !feed.pattern);
const built = found.filter(({feed}) => feed.pattern);

console.log(`\n${found.length} feed(s) found.`);

if (published.length > 0) {
    console.log(`\n${published.length} published by their medium. Paste into db/rss-links.js, under the right category:\n`);
    published.forEach(({medium, feed}) =>
        console.log(`            "${feed.url}",   // ${medium.name}, ${medium.searches.size} search(es)`));
}

if (built.length > 0) {
    console.log(`\n${built.length} built from a page by RSS-Bridge. Add these as your own sources rather than to`);
    console.log('db/rss-links.js: they answer only while the container runs, and a scraper breaks the day');
    console.log('the site changes its pages. Read their first title before trusting one:\n');
    built.forEach(({medium, feed}) => console.log(`  ${medium.site.padEnd(24)} "${feed.titles[0].slice(0, 60)}"`));
    console.log('\n  Add them from "My sources" in the app, by typing the site:');
    built.forEach(({medium}) => console.log(`    ${medium.site}`));
}

await prisma.$disconnect();
