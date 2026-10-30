import {feedsOf} from '../services/briefing-service.js';
import {prisma} from '../config/db.js';
const feeds = new Set(await feedsOf(7));
const rows = await prisma.$queryRawUnsafe(`
    SELECT a.id, a.id_story, a.created_at::date AS day, a.lang, left(a.title, 90) AS title, f.url,
           (SELECT string_agg(m.key, ', ') FROM article_mentions am JOIN mentions m ON m.id = am.id_mention WHERE am.id_article = a.id) AS names
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.created_at > '2026-09-28' AND a.search_text ILIKE '%infantino%'
      AND (a.search_text ILIKE '%lettland%' OR a.search_text ILIKE '%latvia%' OR a.search_text ILIKE '%letton%' OR a.search_text ILIKE '%latvij%' OR a.search_text ILIKE '%lff%')
    ORDER BY a.created_at`);
for (const r of rows) console.log(`${r.day.toISOString().slice(0, 10)} story ${r.id_story} ${feeds.has(r.url) ? 'IN 7' : 'not 7'} [${r.lang}] ${r.title}\n     ${r.names}`);
await prisma.$disconnect();
process.exit(0);
