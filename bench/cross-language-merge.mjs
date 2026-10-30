// The cards of two languages telling the same fact joined by the AI (mergeStories, as the briefing),
// asked only of the cards with a pair of two languages close enough in their texts. Per search: the
// pairs, the cards asked, the merges to judge by hand, the time.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/cross-language-merge.mjs <userId> [threshold] [same]
// 'same': the cards of one language are paired too (two stories of one fact the grouping left apart)
import process from 'node:process';
import {prisma} from '../config/db.js';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';
import {mergeStories} from '../services/utils/profile-ai.js';

const userId = Number(process.argv[2]);
const THRESHOLD = Number(process.argv[3] ?? 0.75);
const SAME_LANGUAGE = process.argv[4] === 'same';
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
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const cards = found.news;
    const links = cards.flatMap((card, i) => [card.url, ...card.sources.map(s => s.url)].map(link => ({card: i, link})));
    const pairs = await prisma.$queryRawUnsafe(`
        WITH m AS (SELECT u.card, a.lang, a.text_dense FROM unnest($1::int[], $2::text[]) AS u(card, link)
                   JOIN articles a ON a.link = u.link WHERE a.text_dense IS NOT NULL)
        SELECT x.card AS a, y.card AS b, max(-(x.text_dense <#> y.text_dense)) AS text
        FROM m x JOIN m y ON x.card < y.card AND (${SAME_LANGUAGE} OR x.lang <> y.lang)
        GROUP BY x.card, y.card HAVING max(-(x.text_dense <#> y.text_dense)) >= $3`, links.map(l => l.card), links.map(l => l.link), THRESHOLD);
    const asked = [...new Set(pairs.flatMap(p => [p.a, p.b]))].sort((x, y) => x - y);
    const candidate = new Set(pairs.map(p => `${p.a}:${p.b}`));
    let merges = new Map(), ms = 0;
    if (asked.length > 1) {
        const started = Date.now();
        merges = await mergeStories(asked.map(i => ({id: String(i), lead: {title: cards[i].title, description: (cards[i].description ?? '').slice(0, 160)}})));
        ms = Date.now() - started;
    }
    console.log(`\n### ${sentence}: ${cards.length} cards, ${pairs.length} pairs, ${asked.length} cards asked, ${merges.size} merged, ${(ms / 1000).toFixed(1)} s`);
    for (const [id, into] of merges) {
        const [a, b] = [Number(into), Number(id)];
        const ok = candidate.has(`${Math.min(a, b)}:${Math.max(a, b)}`);
        const text = pairs.find(p => p.a === Math.min(a, b) && p.b === Math.max(a, b))?.text;
        console.log(`  ${ok ? `${Number(text).toFixed(2)} ` : '(not a pair) '}[${cards[b].language}] ${cards[b].title.slice(0, 80)}\n      -> [${cards[a].language}] ${cards[a].title.slice(0, 80)}`);
    }
}
process.exit(0);
