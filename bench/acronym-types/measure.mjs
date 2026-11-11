//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: measure.mjs
//  Description: "FA" alone (2 928 mentions, no item) and "FC" (67 480): the tagger gives a name such as "Japan FA", "FA Cup", "FC Barcelona" and
//               acronymsOf (mentions.js) adds its acronym as an organisation of its own, which is a KIND of body, not one (defect "FA seul" of the
//               11.11.2026 audit, see the decision log). For each word that names a kind of club or association: how many mentions it has, and the
//               share of a sample of its news that name a longer organisation holding the same word (the artifact). Read-only.
//
//               node bench/acronym-types/measure.mjs [word ...]
//

import 'dotenv/config';
import {prisma} from '../../config/db.js';

const WORDS = process.argv.length > 2 ? process.argv.slice(2)
    : ['FA', 'FC', 'AS', 'SC', 'AC', 'CF', 'SV', 'RC', 'FK', 'SK', 'NK', 'BK', 'IF', 'FF', 'IK', 'CD', 'UD', 'SD', 'AFC', 'OL', 'OM', 'AZ', 'EU', 'UN'];
const SAMPLE = 1500;
const rows = [];
for (const word of WORDS) {
    const [bare] = await prisma.$queryRawUnsafe(`SELECT id, seen, qid FROM mentions WHERE kind = 'organization' AND key = $1 AND name = $2 ORDER BY seen DESC LIMIT 1`, word.toLowerCase(), word);
    if (!bare) { rows.push({word, seen: 0}); continue; }
    const [share] = await prisma.$queryRawUnsafe(`
        WITH s AS (SELECT id_article FROM article_mentions WHERE id_mention = $1 ORDER BY random() LIMIT ${SAMPLE})
        SELECT count(*)::int AS news,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM article_mentions am JOIN mentions m ON m.id = am.id_mention
                   WHERE am.id_article = s.id_article AND m.kind = 'organization' AND m.id <> $1
                     AND m.name ~ ('(^|[^A-Za-z])' || $2 || '([^A-Za-z]|$)')))::int AS with_longer
        FROM s`, bare.id, word);
    const examples = await prisma.$queryRawUnsafe(`
        SELECT m.name, count(*)::int AS n FROM (SELECT id_article FROM article_mentions WHERE id_mention = $1 ORDER BY random() LIMIT ${SAMPLE}) s
        JOIN article_mentions am ON am.id_article = s.id_article JOIN mentions m ON m.id = am.id_mention
        WHERE m.kind = 'organization' AND m.id <> $1 AND m.name ~ ('(^|[^A-Za-z])' || $2 || '([^A-Za-z]|$)')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 4`, bare.id, word);
    rows.push({word, seen: bare.seen, qid: bare.qid, 'share with a longer name': `${Math.round(100 * share.with_longer / Math.max(1, share.news))}%`, examples: examples.map(e => e.name).join(' | ')});
}
console.table(rows);
await prisma.$disconnect();
