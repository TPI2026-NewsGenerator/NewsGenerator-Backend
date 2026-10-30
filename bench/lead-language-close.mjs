// For the cards of a briefing (env BRIEFING) written in another language than the reader's (env
// LANGUAGE, default fr): the stories of the reader's language of the 3 days before it whose centroid is
// the closest to the card's story, with their likeness and a title
import {prisma} from '../config/db.js';

const language = process.env.LANGUAGE ?? 'fr';
const briefing = await prisma.briefings.findUnique({where: {id: Number(process.env.BRIEFING)}});
for (const item of briefing.items.filter(item => item.language && item.language !== language)) {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT o.id, -(o.centroid <#> s.centroid)::real AS likeness, o.media,
               (SELECT a.title FROM articles a WHERE a.id_story = o.id ORDER BY a.created_at LIMIT 1) AS title
        FROM stories s, stories o
        WHERE s.id = $1 AND o.lang = $2 AND o.centroid IS NOT NULL
          AND o.updated_at >= $3::timestamptz - interval '3 days'
        ORDER BY o.centroid <#> s.centroid LIMIT 3`, item.storyId, language, briefing.created_at);
    console.log(`${item.language} | ${item.title.slice(0, 80)}`);
    for (const row of rows) console.log(`   ${row.likeness.toFixed(3)} ${row.title?.slice(0, 95)}`);
}
await prisma.$disconnect();
