// The news of the last 30 days on Latvia and its federation tagged first, for the live test of the
// "Same affair" angles before the backlog is done: node --env-file=.env bench/tag-latvia.mjs <url>
import {tagRows} from '../services/tagging-service.js';
import {prisma} from '../config/db.js';
const url = process.argv[2];
const rows = await prisma.$queryRawUnsafe(`
    SELECT id, title, description, lang FROM articles
    WHERE created_at > now() - interval '30 days' AND entities_at IS NULL
      AND (search_text ILIKE '%latvi%' OR search_text ILIKE '%letton%' OR search_text ILIKE '%lettland%' OR search_text ILIKE '%lettisch%'
        OR search_text ILIKE '%LFF%' OR search_text ILIKE '%lasenko%' OR search_text ILIKE '%ļašenko%' OR search_text ILIKE '%latvij%' OR search_text ILIKE '%letoni%')
    ORDER BY created_at DESC`);
console.log(`${rows.length} news`);
const t = Date.now();
for (let i = 0; i < rows.length; i += 16) {
    await tagRows(url, rows.slice(i, i + 16));
    if (i % 320 === 0) console.log(`${i + 16} in ${Math.round((Date.now() - t) / 1000)} s`);
}
console.log(`done in ${Math.round((Date.now() - t) / 1000)} s`);
await prisma.$disconnect();
process.exit(0);
