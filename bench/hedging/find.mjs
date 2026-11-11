// Real news of the last days that match a pattern, to see how a word of hedging.js is really used (a case for the corpus, a word too broad).
// Each line shows the hedge found and the words around it, in the title or in the description. Read only. The pattern is a POSIX regular
// expression of PostgreSQL, case insensitive, looked for in the title or the description.
//   node --env-file=.env bench/hedging/find.mjs <language|all> "<pattern>" [limit=8] [days=30]
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {hedgedBy} from '../../services/utils/hedging.js';

const [language, pattern, limit = '8', days = '30'] = process.argv.slice(2);
const rows = await prisma.$queryRawUnsafe(
    `SELECT lang, title, left(regexp_replace(coalesce(description, ''), '<[^>]*>', ' ', 'g'), 1500) AS description FROM articles
     WHERE COALESCE(published_at, created_at) >= now() - ($1 || ' days')::interval
       AND ($2 = 'all' OR lang = $2) AND (title ~* $3 OR description ~* $3)
     ORDER BY random() LIMIT $4`, days, language, pattern, Number(limit));
const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
for (const row of rows) {
    const found = hedgedBy(row.title, row.description);
    const text = `${squash(row.title)} || ${squash(row.description)}`;
    // the place of the pattern asked for (the simple ones of PostgreSQL are the same in JavaScript), else of the hedge found
    let place = null;
    try { place = new RegExp(pattern, 'iu').exec(text); } catch { /* a pattern that only PostgreSQL reads */ }
    const at = place ? place.index : found ? text.toLowerCase().indexOf(found) : -1;
    const length = place ? place[0].length : (found ?? '').length;
    const around = at < 0 ? '' : `…${text.slice(Math.max(0, at - 70), at + length + 60)}…`;
    console.log(`[${row.lang}] ${squash(row.title).slice(0, 90)}\n      ${found ?? 'null'}: ${around}`);
}
console.log(`(${rows.length} shown)`);
await prisma.$disconnect();
