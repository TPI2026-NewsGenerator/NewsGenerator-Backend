// The cards of a search in different languages that may tell the same news: for each pair of cards of
// two languages, the closest of their articles (text_dense, title_dense), to judge by hand where the
// same news stops. SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/cross-language-pairs.mjs <userId>
//   -> bench/data/cross-language/pairs.json
import fs from 'node:fs';
import process from 'node:process';
import {prisma} from '../config/db.js';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';

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
];
const pairs = [];
for (const [language, sentence] of SEARCHES) {
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const cards = found.news;
    const links = cards.flatMap((card, i) => [card.url, ...card.sources.map(s => s.url)].map(link => ({card: i, link})));
    const rows = await prisma.$queryRawUnsafe(`
        WITH m AS (SELECT u.card, a.id, a.lang, a.text_dense, a.title_dense FROM unnest($1::int[], $2::text[]) AS u(card, link)
                   JOIN articles a ON a.link = u.link WHERE a.text_dense IS NOT NULL)
        SELECT x.card AS a, y.card AS b, max(1 - (x.text_dense <=> y.text_dense)) AS text, max(1 - (x.title_dense <=> y.title_dense)) AS title
        FROM m x JOIN m y ON x.card < y.card AND x.lang <> y.lang
        GROUP BY x.card, y.card`, links.map(l => l.card), links.map(l => l.link));
    for (const row of rows) {
        if (row.text < 0.6) continue;
        const [a, b] = [cards[row.a], cards[row.b]];
        pairs.push({sentence, text: Number(row.text.toFixed(3)), title: Number(row.title.toFixed(3)),
            a: `[${a.language}] ${a.title} (${a.source})`, b: `[${b.language}] ${b.title} (${b.source})`,
            aAt: a.publishedAt, bAt: b.publishedAt});
    }
    console.log(`${sentence}: ${cards.length} cards, ${rows.length} pairs of two languages, ${rows.filter(r => r.text >= 0.6).length} above 0.6`);
}
fs.mkdirSync('bench/data/cross-language', {recursive: true});
pairs.sort((x, y) => y.text - x.text);
fs.writeFileSync('bench/data/cross-language/pairs.json', JSON.stringify(pairs, null, 1));
process.exit(0);
