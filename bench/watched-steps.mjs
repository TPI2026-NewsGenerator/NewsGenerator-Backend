// The steps of the news of words followed, timed: the database (searchArticles), then the news kept per
// word (newsOfTerms). env PROFILE_ID, DAYS (30), WORDS ("VAR,UEFA"). Read only
import {FeedModel} from '../models/feed-model.js';
import {feedsOf, newsOfTerms} from '../services/briefing-service.js';
import {Filter} from '../services/utils/filter.js';

const words = (process.env.WORDS ?? 'VAR,UEFA,Dario Amodei').split(',');
const days = Number(process.env.DAYS ?? 30);
const since = new Date(Date.now() - days * 24 * 3600e3);
const feedUrls = await feedsOf(Number(process.env.PROFILE_ID));
let t = Date.now();
const keywords = Filter.parse([words.map(term => `"${term}"`).join(', ')]);
const articles = await FeedModel.searchArticles({feedUrls, keywords, timeframe: {start: since}});
console.log(`${days} days, ${feedUrls.length} feeds: ${articles.length} articles from the database in ${Date.now() - t} ms, ${Math.round(JSON.stringify(articles).length / 1024)} KB`);
t = Date.now();
const groups = newsOfTerms(words, articles);
console.log(`news of ${words.length} words in ${Date.now() - t} ms: ${groups.map(group => `${group.term} ${group.count}`).join(', ')}`);
t = Date.now();
for (const word of words) {
    const alone = await FeedModel.searchArticles({feedUrls, keywords: Filter.parse([`"${word}"`]), timeframe: {start: since}});
    console.log(`  ${word} alone: ${alone.length} articles in ${Date.now() - t} ms`);
    t = Date.now();
}
process.exit(0);
