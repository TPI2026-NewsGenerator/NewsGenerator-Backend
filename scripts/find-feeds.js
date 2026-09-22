//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: find-feeds.js
//  Description: Find the RSS feeds of a website, to fill db/rss-links.js
//               usage: node scripts/find-feeds.js https://www.skysports.com [...other sites]
//

"use strict"

import process from 'node:process'
import {findFeeds} from '../services/utils/feed-finder.js';

const sites = process.argv.slice(2);
if (sites.length === 0) {
    console.log('usage: node scripts/find-feeds.js <site url> [...other sites]');
    process.exit(1);
}

for (let site of sites) {
    console.log(`\n=== ${site}`);
    try {
        const feeds = await findFeeds(site);
        if (feeds.length === 0) console.log('  no feed found');

        for (let feed of feeds) {
            const age = feed.newest ? `${Math.round((Date.now() - feed.newest) / 3600e3)}h ago` : 'no date';
            console.log(`  ${String(feed.items).padStart(3)} news, newest ${age.padEnd(9)} ${feed.url}`);
        }
    } catch (err) {
        console.log(`  ${err.message}`);
    }
}
