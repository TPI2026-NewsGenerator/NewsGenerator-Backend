// The cards of a search in another language than the one searched translated as the client asks them:
// the first 30 cards with their description, the titles of their facts. Time and translations.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/search-translations.mjs <userId> <language> "<sentence>"
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';

const [userId, language, sentence] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
    timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
const cards = found.news.slice(0, 30);
const facts = cards.flatMap(card => (card.facts ?? []).filter(fact => fact.url !== card.url)).slice(0, 60);
const foreign = cards.filter(card => card.language !== language).length;
let started = Date.now();
const translations = await NewsService.translateNews({news: cards.map(card => card.url), titles: facts.map(fact => fact.url), language});
console.log(`${found.news.length} cards, ${foreign} of the first 30 in another language, ${facts.length} facts: ${translations.length} translated in ${((Date.now() - started) / 1000).toFixed(1)} s`);
const byUrl = new Map(translations.map(t => [t.url, t]));
for (const card of cards.filter(card => card.language !== language)) {
    const t = byUrl.get(card.url);
    console.log(`\n[${card.language}] ${card.title.slice(0, 100)}\n  -> ${t?.title ?? '(none)'}\n  ${t?.description ? `-> ${t.description.slice(0, 160)}` : `(description ${card.description ? 'not translated' : 'none'})`}`);
}
started = Date.now();
await NewsService.translateNews({news: cards.map(card => card.url), language});
console.log(`\nasked again: ${Date.now() - started} ms`);
process.exit(0);
