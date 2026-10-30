// The cards of searches after the join of the cards of one fact (joinFacts in news-service.js): each
// card with the titles it holds, from its story and from the cards joined to it, to judge by hand.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/join-cards.mjs <userId>
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';
import {prisma} from '../config/db.js';

const userId = Number(process.argv[2]);
const SEARCHES = [
    ['fr', "les sanctions disciplinaires de l'UEFA contre des clubs"],
    ['fr', "l'affaire Negreira et le Barça"],
    ['fr', "les désignations d'arbitres"],
    ['en', 'Taylor Swift'],
    ['fr', 'les tensions entre la Chine et Taïwan'],
    ['fr', "la hausse des prix de l'énergie"],
    ['en', 'wildfires'],
    ['de', 'Schiedsrichter im Fußball'],
    ['fr', 'la visite du pape'],
    ['en', 'electric car sales in China'],
    ['fr', 'les décisions des arbitres en Ligue des champions'],
    ['de', 'UEFA Strafen gegen Vereine'],
];
for (const [language, sentence] of SEARCHES) {
    const started = Date.now();
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const links = found.news.flatMap(card => [card.url, ...card.sources.map(s => s.url)]);
    const stories = new Map((await prisma.$queryRawUnsafe('SELECT link, id_story, lang FROM articles WHERE link = ANY($1::text[])', links))
        .map(row => [row.link, row]));
    const joined = found.news.filter(card => new Set([card.url, ...card.sources.map(s => s.url)].map(link => stories.get(link)?.id_story)).size > 1);
    console.log(`\n### ${sentence}: ${found.news.length} cards, ${joined.length} holding several stories, ${seconds} s`);
    for (const card of joined) {
        console.log(`  [${card.language}] ${card.title.slice(0, 90)}`);
        const seen = new Set([stories.get(card.url)?.id_story]);
        for (const source of card.sources) {
            const row = stories.get(source.url);
            if (seen.has(row?.id_story)) continue;
            seen.add(row?.id_story);
            console.log(`      + [${row?.lang}] ${(source.title ?? '').slice(0, 90)}`);
        }
    }
}
process.exit(0);
