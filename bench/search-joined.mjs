// The cards of a search with the cards of one fact in several languages joined: the languages of each
// card and the time. SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/search-joined.mjs <userId> <language> "<sentence>"
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';

const [userId, language, sentence] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const started = Date.now();
const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
    timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
console.log(`${found.news.length} cards in ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const card of found.news.slice(0, 15)) {
    console.log(`  ${card.match === 'answer' ? '+' : '~'} [${card.language}] ${card.title.slice(0, 80)} — ${card.corroboration.media} media: ${[card.source, ...card.sources.map(s => s.source)].slice(0, 8).join(', ')}`);
}
process.exit(0);
