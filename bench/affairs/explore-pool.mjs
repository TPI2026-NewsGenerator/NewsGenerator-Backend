// Time the ways of finding the stories of one affair: thread mates, close stories by days, sibling threads
import 'dotenv/config';
import {prisma} from '../../config/db.js';

const seed = Number(process.argv[2] ?? 1900910);
const time = async (label, run) => {
    const t = Date.now();
    const rows = await run();
    console.log(`${label}: ${rows.length} rows in ${Date.now() - t} ms`);
    return rows;
};
const [s] = await prisma.$queryRawUnsafe('SELECT id, lang, id_thread, created_at, updated_at FROM stories WHERE id = $1', seed);
console.log('seed', s);
await time('thread mates', () => prisma.$queryRawUnsafe(`
    SELECT o.id, o.lang, o.created_at FROM stories o WHERE o.id_thread = $1 ORDER BY o.created_at`, s.id_thread));
for (const days of [3, 7, 14, 30]) {
    await time(`close stories ${days} d (>=0.6, any lang)`, () => prisma.$queryRawUnsafe(`
        SELECT o.id, o.lang, -(o.centroid <#> s.centroid)::real AS likeness
        FROM stories s CROSS JOIN LATERAL (
            SELECT o.id, o.lang, o.centroid FROM stories o
            WHERE o.centroid IS NOT NULL AND o.updated_at >= now() - make_interval(days => $2::int)
            ORDER BY o.centroid <#> s.centroid LIMIT 80 OFFSET 0) o
        WHERE s.id = $1`, seed, days));
}
await time('sibling threads 30 d other langs', () => prisma.$queryRawUnsafe(`
    SELECT u.id, u.lang, u.n_stories, -(u.centroid <#> t.centroid)::real AS likeness
    FROM threads t CROSS JOIN LATERAL (
        SELECT u.id, u.lang, u.n_stories, u.centroid FROM threads u
        WHERE u.centroid IS NOT NULL AND u.lang <> t.lang AND u.updated_at >= now() - interval '30 days'
        ORDER BY u.centroid <#> t.centroid LIMIT 40 OFFSET 0) u
    WHERE t.id = $1`, s.id_thread));
const [c] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS stories FROM stories WHERE updated_at >= now() - interval '30 days'`);
const [d] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS threads FROM threads WHERE updated_at >= now() - interval '30 days'`);
console.log('stories 30 d', c.stories, 'threads 30 d', d.threads);
await prisma.$disconnect();
