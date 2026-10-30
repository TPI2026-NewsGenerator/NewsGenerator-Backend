// where the time of a sentence search goes: embedder, SQL, AI
// node --env-file=.env bench/time-search.mjs <userId> <language> "<sentence>"
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import * as embedder from '../services/utils/embedder.js';
if (process.argv[5] !== 'web') process.env.SEARCH_GOOGLE_NEWS = 'off';
const [userId, language, sentence] = process.argv.slice(2);
const timed = (obj, name, key) => {
    const original = obj[key];
    obj[key] = async (...args) => {
        const t = Date.now();
        try { return await original(...args); } finally { console.log(`${name} ${((Date.now() - t) / 1000).toFixed(1)} s`); }
    };
};
timed(FeedModel, 'closestArticles', 'closestArticles');
timed(FeedModel, 'similarArticlePairs', 'similarArticlePairs');
timed(FeedModel, 'threadArticles', 'threadArticles');
const t = Date.now();
const {embed} = embedder;
const t1 = Date.now(); await embed([sentence]); console.log(`embed ${((Date.now() - t1) / 1000).toFixed(1)} s`);
const result = await NewsService.getNews({keywords: [sentence], category: ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'],
    userId: Number(userId), language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});
console.log(`total ${((Date.now() - t) / 1000).toFixed(1)} s, ${result.news.length} cards`);
process.exit(0);
