// How well the words of hedging.js cover the news that really come in: per language, how many news of the last days there are and how many
// of them hold a hedge (title or description), and what the hedges are. A language with many news and no hedge at all is a language the list
// does not speak; a hedge that holds a large share of a language is a word too broad. Read only.
//   node --env-file=.env bench/hedging/coverage.mjs [days=14] [language to list the hits of]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {hedgedBy} from '../../services/utils/hedging.js';

const days = Number(process.argv[2] ?? 14);
const only = process.argv[3] ?? null;

const rows = await prisma.$queryRawUnsafe(
    `SELECT lang, title, description FROM articles
     WHERE COALESCE(published_at, created_at) >= now() - ($1 || ' days')::interval AND lang IS NOT NULL`, String(days));
const clean = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ');
const byLanguage = new Map();
for (const row of rows) {
    const one = byLanguage.get(row.lang) ?? {news: 0, hedged: 0, hits: new Map(), examples: new Map()};
    one.news++;
    const found = hedgedBy(row.title, clean(row.description));
    if (found) {
        one.hedged++;
        one.hits.set(found, (one.hits.get(found) ?? 0) + 1);
        if (!one.examples.has(found)) one.examples.set(found, []);
        if (one.examples.get(found).length < 3) one.examples.get(found).push(String(row.title).slice(0, 110));
    }
    byLanguage.set(row.lang, one);
}
const total = rows.length;
console.log(`${total} news of ${days} days, ${byLanguage.size} languages\n`);
let covered = 0;
for (const [language, one] of [...byLanguage].sort((a, b) => b[1].news - a[1].news)) {
    covered += one.news;
    const top = [...one.hits].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word, n]) => `${word} ${n}`).join(', ');
    console.log(`${language.padEnd(4)} ${String(one.news).padStart(7)} news (${(100 * covered / total).toFixed(1)}% cumulated)  hedged ${String(one.hedged).padStart(5)} = ${(100 * one.hedged / one.news).toFixed(2)}%  ${top}`);
    if (only === language) for (const [word, list] of one.examples) console.log(`      ${word}: ${list.join(' || ')}`);
}
await prisma.$disconnect();
