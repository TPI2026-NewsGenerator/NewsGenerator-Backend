import process from 'node:process';
import {siteFeeds, readFeeds} from '../services/utils/feed-finder.js';
const feeds = await siteFeeds('dailymail.com');
console.log('siteFeeds', feeds.length, feeds.slice(0, 30));
for (const url of feeds.slice(0, 20)) {
    console.log('reading', url);
    const r = await readFeeds([url]);
    console.log('  ', r.length ? r[0].items.length : 'none');
}
process.exit(0);
