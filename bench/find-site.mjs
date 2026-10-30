// the feeds findFeeds gives for a site added by hand, the first one is the one added
// node bench/find-site.mjs <site> [language]
import 'dotenv/config';
import {findFeeds} from '../services/utils/feed-finder.js';
const feeds = await findFeeds(process.argv[2], {language: process.argv[3] ?? 'fr'});
console.table(feeds.slice(0, 8).map(f => ({url: f.url.slice(0, 70), items: f.items, newest: f.newest?.toISOString?.().slice(0, 16), recent: f.recent, language: f.language})));
process.exit(0);
