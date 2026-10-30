// For the cards of a briefing (env BRIEFING): the languages of the articles of the thread of their story,
// and a few titles in the language of the reader (env LANGUAGE, default fr) from that thread
import {prisma} from '../config/db.js';

const language = process.env.LANGUAGE ?? 'fr';
const briefing = await prisma.briefings.findUnique({where: {id: Number(process.env.BRIEFING)}});
for (const item of briefing.items) {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT a.lang, count(*)::int AS n, count(DISTINCT a.id_story)::int AS stories,
               (array_agg(a.title ORDER BY a.created_at DESC) FILTER (WHERE a.lang = $2))[1:2] AS titles
        FROM stories s JOIN articles a ON a.id_story IN (SELECT id FROM stories WHERE id_thread = s.id_thread)
        WHERE s.id = $1 AND s.id_thread IS NOT NULL
        GROUP BY a.lang ORDER BY n DESC`, item.storyId, language);
    console.log(`${item.language} | ${rows.map(row => `${row.lang}:${row.n}/${row.stories}st`).join(' ')} | ${item.title.slice(0, 50)}`);
    for (const row of rows.filter(row => row.lang === language)) for (const title of row.titles ?? []) console.log(`     ${title.slice(0, 100)}`);
}
await prisma.$disconnect();
