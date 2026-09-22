//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: check-coverage.js
//  Description: Compare what the cache finds for a keyword with what Google News finds, to see
//               which media are missing from db/rss-links.js
//               usage: node scripts/check-coverage.js "referee" sport [days]
//

"use strict"

import process from 'node:process'
import {rss} from '../db/rss-links.js';
import {FeedModel} from '../models/feed-model.js';
import {Filter} from '../services/utils/filter.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {prisma} from '../config/db.js';
import Links from '../services/utils/links.js';

// Google News gives a feed for any search, it covers thousands of media
// its links go through a Google redirect, so it is used here to find media, not to read articles
const googleNewsFeed = (keyword) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`;

// "Title of the news - The Guardian" -> "the guardian"
const mediaOf = (title) => title.split(' - ').pop().trim().toLowerCase();

// media already covered: hostnames of the feeds of db/rss-links.js, e.g. "theguardian.com" -> "theguardian"
const knownMedia = () => new Set(
    Object.values(rss)
        .flatMap(language => Object.values(language).flat())
        .map(url => {
            try {
                return new URL(url).hostname.replace(/^(www|rss|feeds|feed)\./, '').split('.')[0];
            } catch {
                return null;
            }
        })
        .filter(Boolean)
);

const [keyword, categories = 'sport', days = '2'] = process.argv.slice(2);
if (!keyword) {
    console.log('usage: node scripts/check-coverage.js "<keyword>" [categories, comma separated] [days]');
    process.exit(1);
}

const start = new Date(Date.now() - Number(days) * 24 * 3600 * 1000);
const categoryList = categories.split(',').map(category => category.trim());

// what the cache gives
const articles = await FeedModel.searchArticles({
    feedUrls: Links.getCategoriesLinks(categoryList),
    keywords: Filter.parse([keyword]),
    timeframe: {start},
});
const ourMedia = new Map();
for (let article of articles) {
    const host = new URL(article.link).hostname.replace(/^www\./, '');
    ourMedia.set(host, (ourMedia.get(host) ?? 0) + 1);
}

// what Google News gives for the same keyword
const [feed] = await Crawlers.Xml([{url: googleNewsFeed(keyword)}]);
const googleNews = feed.items.filter(item => item.link && new Date(item.pubDate) >= start);
const googleMedia = new Map();
for (let item of googleNews) {
    const media = mediaOf(item.title);
    googleMedia.set(media, (googleMedia.get(media) ?? 0) + 1);
}

console.log(`"${keyword}" in ${categoryList.join(', ')}, last ${days} day(s)`);
console.log(`  cache       : ${articles.length} news from ${ourMedia.size} media`);
console.log(`  Google News : ${googleNews.length} news from ${googleMedia.size} media`);

const known = knownMedia();
const missing = [...googleMedia.entries()]
    .filter(([media]) => ![...known].some(name => media.includes(name) || name.includes(media.split(' ')[0])))
    .sort((a, b) => b[1] - a[1]);

console.log(`\nMedia publishing on this subject but missing from db/rss-links.js (${missing.length}):`);
missing.slice(0, 15).forEach(([media, count]) => console.log(`  ${String(count).padStart(2)} news  ${media}`));
console.log('\nFind their feed with: node scripts/find-feeds.js <their site>');

await prisma.$disconnect();
