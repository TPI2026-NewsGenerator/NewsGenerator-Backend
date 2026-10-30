// Searches sentences for a reader as the search page does (every category of the language, the last
// 7 days) and prints the cards with their medium. Run inside the API container:
//   docker exec -i newsgenerator-api node --input-type=module - <userId> < this file
import {NewsService} from '/app/services/news-service.js';
import {FeedService} from '/app/services/feed-service.js';
import {guardFetch} from '/app/services/utils/public-url.js';

guardFetch();
const userId = Number(process.argv[2]);
const SEARCHES = [
    ['fr', "les décisions d'arbitrage et la VAR en Ligue des champions"],
    ['fr', "les sanctions disciplinaires de l'UEFA contre des clubs"],
    ['en', 'referee appointments for the Champions League matches this week'],
    ['en', 'UEFA disciplinary proceedings and fines'],
    ['de', 'Schiedsrichter Fehlentscheidung Videobeweis Bundesliga'],
];
for (const [language, sentence] of SEARCHES) {
    const started = Date.now();
    try {
        const found = await NewsService.getNews({
            keywords: [sentence], category: FeedService.categories(language), userId, language,
            timeframe: {start: new Date(Date.now() - 7 * 24 * 3600e3)},
        });
        const answers = found.news.filter(card => card.match !== 'related');
        console.log(`\n[${language}] "${sentence}": ${answers.length} answers, ${found.news.length - answers.length} close, ${Math.round((Date.now() - started) / 1000)} s${found.web ? ' (with Google News)' : ''}`);
        for (const card of found.news.slice(0, 12)) {
            console.log(`  ${card.match === 'related' ? '~' : '+'} ${card.title?.slice(0, 110)} — ${card.source ?? card.medium ?? ''}`);
        }
    } catch (err) {
        console.log(`\n[${language}] "${sentence}": failed, ${err.message ?? err}`);
    }
}
process.exit(0);
