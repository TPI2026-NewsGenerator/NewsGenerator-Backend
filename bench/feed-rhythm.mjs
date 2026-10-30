// How often the feeds publish: feeds per number of news these 24 hours, and the share of the news they
// bring. node --env-file=.env bench/feed-rhythm.mjs
import {prisma} from '../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    WITH per AS (
        SELECT f.id, count(a.id) AS news FROM feeds f
        LEFT JOIN articles a ON a.id_feed = f.id AND a.created_at > now() - interval '24 hours'
        WHERE f.last_fetched_at > now() - interval '24 hours'
        GROUP BY f.id
    )
    SELECT CASE WHEN news = 0 THEN '0' WHEN news < 6 THEN '1-5' WHEN news < 24 THEN '6-23' WHEN news < 72 THEN '24-71'
                WHEN news < 144 THEN '72-143' ELSE '144+' END AS per_day,
           count(*) AS feeds, sum(news) AS news
    FROM per GROUP BY 1 ORDER BY min(news)`);
console.table(rows.map(r => ({per_day: r.per_day, feeds: Number(r.feeds), news: Number(r.news)})));
process.exit(0);
