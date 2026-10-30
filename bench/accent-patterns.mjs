// The time of the search by exact words with the patterns as they are and with every Latin letter
// accepting its accented forms ("Barça" -> "B[aà...]r[cç...][aà...]"), on every feed, 7 and 30 days
import {prisma} from '../config/db.js';
import {Filter} from '../services/utils/filter.js';

const ACCENTED = new Map();
const RANGE_END = Number(process.env.RANGE_END ?? 0x24F);
for (let code = 0xC0; code <= RANGE_END; code++) {
    if (code === 0xD7 || code === 0xF7) continue;
    const char = String.fromCodePoint(code);
    const base = Filter.withoutAccents(char);
    if (base.length === 1 && base !== char && /[A-Za-z]/.test(base)) ACCENTED.set(base, (ACCENTED.get(base) ?? '') + char);
}
const anyAccent = (term) => [...term].map(char => {
    const base = Filter.withoutAccents(char);
    return /^[A-Za-z]$/.test(base) && ACCENTED.has(base) ? `[${base}${ACCENTED.get(base)}]` : char;
}).join('');

const feedUrls = (await prisma.feeds.findMany({select: {url: true}})).map(feed => feed.url);
const run = async (keywords, days, accents) => {
    const parsed = Filter.parse([keywords]);
    const sql = Filter.keywordsSql(parsed, 3, 'a.search_text');
    // the terms only: the pattern of each is rebuilt around its letters
    const terms = [...parsed.groups.flat(), ...parsed.excluded];
    const params = accents ? terms.map(term => Filter.toPattern(term).replace(term.exact ? term.text.split(/\s+/).join('[[:space:]]+') : term.text, anyAccent(term.exact ? term.text.split(/\s+/).join('[[:space:]]+') : term.text))) : sql.params;
    const started = Date.now();
    const rows = await prisma.$queryRawUnsafe(`SELECT a.title FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1::text[]) AND COALESCE(a.published_at, a.created_at) >= $2::timestamptz AND ${sql.sql}`,
        feedUrls, new Date(Date.now() - days * 864e5), ...params);
    return {ms: Date.now() - started, n: rows.length, params: params.join(' ').slice(0, 90)};
};
for (const keywords of ['"Negreira" -Barça', 'Negreira', 'Barca', 'Zürich', 'Lewandowski', 'désignations']) {
    for (const days of [7, 30]) {
        const before = await run(keywords, days, false);
        const after = await run(keywords, days, true);
        console.log(`${keywords.padEnd(20)} ${days}d  now ${before.n} in ${before.ms} ms | accents ${after.n} in ${after.ms} ms   ${after.params}`);
    }
}
await prisma.$disconnect();
