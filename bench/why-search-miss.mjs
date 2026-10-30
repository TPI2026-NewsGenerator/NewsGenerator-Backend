// why a news Google gave is not in our answer: is it among the candidates, and how the AI sorts it
// node --env-file=.env bench/why-search-miss.mjs <userId> <language> "<sentence>" "<title words>" ...
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {sortByMeaning} from '../services/utils/search-ai.js';

const [userId, language, sentence, ...wanted] = process.argv.slice(2);
const calls = [];
const original = FeedModel.closestArticles;
FeedModel.closestArticles = async (args) => {
    const rows = await original(args);
    calls.push({args, rows});
    return rows;
};
const result = await NewsService.getNews({keywords: [sentence], category: ['world', 'press', 'sport', 'politics', 'economy', 'technology', 'science'],
    userId: Number(userId), language, timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});
const {rows, args} = calls.at(-1);
console.log(`searches ${calls.length}, web ${result.web === true}`);
console.log(`feeds ${args.feedUrls.length}, candidates ${rows.length}, cards ${result.news.length}`);
const found = rows.map((row, i) => ({i, row})).filter(({row}) => wanted.some(w => row.title.toLowerCase().includes(w.toLowerCase())));
for (const {i, row} of found) console.log(`candidate #${i}: ${row.title}`);
if (!found.length) console.log('none of the wanted titles among the candidates');
const sorted = await sortByMeaning(sentence, rows.map(r => ({id: String(r.id), title: r.title, description: r.description})));
const verdict = (id) => sorted.answers.includes(String(id)) ? 'answer' : sorted.related.includes(String(id)) ? 'related' : 'left out';
for (const {row} of found) console.log(`AI: ${verdict(row.id)} — ${row.title.slice(0, 90)}`);
console.log(`AI answers ${sorted.answers.length}, related ${sorted.related.length}`);
process.exit(0);
