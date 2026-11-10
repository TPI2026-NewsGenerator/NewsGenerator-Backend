// Exploration read-only: how Infantino is tagged in the news kept
import {prisma} from '../../config/db.js';
const t0 = Date.now();
const names = await prisma.$queryRawUnsafe(`
  SELECT m.id, m.name, m.kind, m.qid, m.seen,
         (SELECT count(*)::int FROM article_mentions am WHERE am.id_mention = m.id) AS news
  FROM mentions m
  WHERE m.key LIKE '%infantino%'
  ORDER BY m.seen DESC LIMIT 25`);
console.table(names);
console.log('ms', Date.now() - t0);
await prisma.$disconnect();
