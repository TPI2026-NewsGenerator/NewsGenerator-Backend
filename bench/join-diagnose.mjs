// Why cards of one fact stay apart in a search: the cards whose title holds a word, the likeness of
// their texts (each article of a card against each of another), their stories and threads, and what
// the AI of the join answers when asked them alone.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/join-diagnose.mjs <userId> <language> "<sentence>" <word>
import process from 'node:process';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';
import {mergePrompt, mergeStories} from '../services/utils/profile-ai.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {prisma} from '../config/db.js';

const [userId, language, sentence, word] = [Number(process.argv[2]), process.argv[3], process.argv[4], process.argv[5]];
const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
    timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
console.log(`${found.news.length} cards`);
found.news.forEach((card, i) => console.log(`  ${i} ${card.match === 'answer' ? '+' : '~'} [${card.language}] ${card.title.slice(0, 70)} — ${[card.source, ...card.sources.map(s => s.source)].join(', ')}`));

const cards = found.news.map((card, i) => ({i, card})).filter(({card}) => [card.title, card.description ?? ''].join(' ').toLowerCase().includes(word.toLowerCase()));
const links = cards.flatMap(({i, card}) => [card.url, ...card.sources.map(s => s.url)].map(link => ({i, link})));
const rows = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.link, a.lang, a.id_story, s.id_thread, a.title
    FROM articles a LEFT JOIN stories s ON s.id = a.id_story WHERE a.link = ANY($1::text[])`, links.map(l => l.link));
const cardOf = new Map(links.map(l => [l.link, l.i]));
console.log(`\narticles of the cards holding "${word}":`);
for (const row of rows) console.log(`  card ${cardOf.get(row.link)} #${row.id} [${row.lang}] story ${row.id_story} thread ${row.id_thread} ${row.title.slice(0, 60)}`);

const likeness = await prisma.$queryRawUnsafe(`
    SELECT x.id AS a, y.id AS b, round((-(x.text_dense <#> y.text_dense))::numeric, 3) AS text,
           round((-(x.title_dense <#> y.title_dense))::numeric, 3) AS title
    FROM articles x JOIN articles y ON x.id < y.id
    WHERE x.id = ANY($1::int[]) AND y.id = ANY($1::int[])`, rows.map(row => row.id));
const rowOf = new Map(rows.map(row => [row.id, row]));
console.log('\nlikeness between articles of different cards (text, title):');
for (const pair of likeness) {
    const [x, y] = [rowOf.get(pair.a), rowOf.get(pair.b)];
    if (cardOf.get(x.link) === cardOf.get(y.link)) continue;
    console.log(`  card ${cardOf.get(x.link)} [${x.lang}] x card ${cardOf.get(y.link)} [${y.lang}]: text ${pair.text}, title ${pair.title}`);
}

const asked = cards.map(({i, card}) => ({id: String(i), lead: {title: card.title, description: (card.description ?? '').slice(0, 160)}}));
for (let run = 0; run < 3; run++) console.log(`merge asked alone, run ${run + 1}:`, JSON.stringify([...await mergeStories(asked)]));
// a card without a description given the one of an article it holds
const described = await prisma.$queryRawUnsafe(`SELECT link, description FROM articles WHERE link = ANY($1::text[]) AND description <> ''`, links.map(l => l.link));
const descriptionOf = new Map(described.map(row => [row.link, row.description]));
const fallback = cards.map(({i, card}) => ({id: String(i), lead: {title: card.title, description: (card.description || [card.url, ...card.sources.map(s => s.url)].map(link => descriptionOf.get(link)).find(Boolean) || '').slice(0, 160)}}));
console.log('descriptions given:', fallback.map(c => `${c.id}: ${c.lead.description.slice(0, 50)}`).join(' | '));
for (let run = 0; run < 3; run++) console.log(`merge with descriptions, run ${run + 1}:`, JSON.stringify([...await mergeStories(fallback)]));
console.log('prompt cards:', JSON.stringify(fallback));
console.log('raw answer:', JSON.stringify((await ollamaJson(mergePrompt(fallback))).stories));
process.exit(0);
