// The search reading every language, the news in the language searched with their own share of the
// candidates: per sentence the candidates, the news the AI read, the answers per language and the time.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/search-every-language.mjs <userId>
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedModel} from '../models/feed-model.js';
import {FeedService} from '../services/feed-service.js';

const userId = Number(process.argv[2]);
const SEARCHES = [
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
    ['fr', "les désignations d'arbitres"],
    ['de', 'Schiedsrichter im Fußball'],
    ['en', 'referee appointments for the Champions League matches this week'],
    ['fr', 'les sanctions disciplinaires de l\'UEFA contre des clubs'],
    ['fr', "les prix de l'immobilier en Suisse"],
    ['en', 'Taylor Swift'],
];
const original = FeedModel.closestArticles;
for (const [language, sentence] of SEARCHES) {
    let rows = [], sqlMs = 0;
    FeedModel.closestArticles = async (args) => {
        const started = Date.now();
        rows = await original(args);
        sqlMs = Date.now() - started;
        return rows;
    };
    const started = Date.now();
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const answers = found.news.filter(card => card.match === 'answer');
    const per = (list) => Object.entries(list.reduce((n, card) => ({...n, [card.language ?? '?']: (n[card.language ?? '?'] ?? 0) + 1}), {}))
        .sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', ');
    const read = new Set(rows.map(r => r.id_story != null ? `s${r.id_story}` : `t${r.title}`)).size;
    console.log(`\n[${language}] ${sentence}\n  ${rows.length} candidates (${rows.filter(r => r.lang === language).length} in ${language}) in ${sqlMs} ms, ${read} read, ${Math.round((Date.now() - started) / 1000)} s`
        + `\n  ${answers.length} answers (${per(answers)}), ${found.news.length - answers.length} close`);
    for (const card of answers.slice(0, 12)) console.log(`    + [${card.language}] ${card.title.slice(0, 95)} (${card.source})`);
}
process.exit(0);
