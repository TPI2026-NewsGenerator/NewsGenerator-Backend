// For the cards of a briefing (env BRIEFING), the language of their lead and the languages of the other
// articles of their story: how many cards written in another language could be led by an article in
// the language of the reader (env LANGUAGE, default fr)
import {prisma} from '../config/db.js';

const language = process.env.LANGUAGE ?? 'fr';
const briefing = await prisma.briefings.findUnique({where: {id: Number(process.env.BRIEFING)}});
let could = 0;
for (const item of briefing.items) {
    const ids = [item.storyId, ...(item.mergedStoryIds ?? [])];
    const rows = await prisma.$queryRawUnsafe(
        `SELECT a.lang, count(*)::int AS n FROM articles a WHERE a.id_story = ANY($1::int[]) GROUP BY a.lang ORDER BY n DESC`, ids);
    const langs = rows.map(row => `${row.lang ?? '?'}:${row.n}`).join(' ');
    const foreign = item.language && item.language !== language;
    const has = rows.some(row => row.lang === language);
    if (foreign && has) could++;
    console.log(`${item.language ?? '?'} ${foreign && has ? '->' + language : '   '} | ${langs} | ${item.title.slice(0, 70)}`);
}
console.log(`${could} of ${briefing.items.length} cards in another language have an article in ${language}`);
await prisma.$disconnect();
