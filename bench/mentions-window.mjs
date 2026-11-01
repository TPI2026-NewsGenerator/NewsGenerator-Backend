// The news naming many names, by the names the tagger found, with and without the window bounding the links
// read (article_mentions is read from the first article of the window: the ids grow with the days). env
// PROFILE_ID, COUNT=100. Read only
import {prisma} from '../config/db.js';
import {feedsOf} from '../services/briefing-service.js';
import {mentionKey} from '../services/utils/mentions.js';

const count = Number(process.env.COUNT ?? 100);
const feedUrls = await feedsOf(Number(process.env.PROFILE_ID ?? 7));
const names = (await prisma.$queryRawUnsafe(`
    SELECT name FROM mentions WHERE kind = 'person' AND length(name) BETWEEN 6 AND 30 AND name ~ ' '
    ORDER BY seen DESC OFFSET 200 LIMIT $1`, count)).map(row => row.name);
const keys = [...new Set(names.map(mentionKey))];

const QUERY = (bounded) => `
    SELECT a.id, a.id_story, array_agg(DISTINCT m.key) AS keys
    FROM mentions m
    JOIN article_mentions am ON am.id_mention = m.id
    JOIN articles a ON a.id = am.id_article
    JOIN feeds f ON f.id = a.id_feed
    WHERE (m.key = ANY($1::text[]) OR m.qid = ANY($2::text[]))
      ${bounded ? `AND am.id_article >= COALESCE((SELECT id FROM articles WHERE created_at >= $4::timestamptz - interval '1 day' ORDER BY created_at LIMIT 1), 0)` : ''}
      AND f.url = ANY($3::text[]) AND COALESCE(a.published_at, a.created_at) >= $4::timestamptz
    GROUP BY a.id`;
for (const days of [1, 8, 30]) {
    const since = new Date(Date.now() - days * 24 * 3600e3);
    for (const bounded of [false, true]) {
        if (!bounded && days > 8) continue;
        const started = Date.now();
        const rows = await prisma.$queryRawUnsafe(QUERY(bounded), keys, [], feedUrls, since);
        console.log(`${days} days, ${count} names, ${bounded ? 'window bounded' : 'as it is'}: ${rows.length} articles in ${Date.now() - started} ms`);
    }
}
process.exit(0);
