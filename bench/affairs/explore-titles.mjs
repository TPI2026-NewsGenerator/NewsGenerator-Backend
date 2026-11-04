// The pool of one affair as the AI would read it: thread mates and the closest stories of the month
import 'dotenv/config';
import {prisma} from '../../config/db.js';

const seed = Number(process.argv[2]);
const per = Number(process.argv[3] ?? 60);
const rows = await prisma.$queryRawUnsafe(`
    WITH s AS (SELECT id, id_thread, centroid FROM stories WHERE id = $1),
    mates AS (SELECT o.id, 'thread' AS via, -(o.centroid <#> (SELECT centroid FROM s))::real AS likeness
              FROM stories o WHERE o.id_thread = (SELECT id_thread FROM s)),
    close AS (SELECT o.id, 'close' AS via, -(o.centroid <#> (SELECT centroid FROM s))::real AS likeness
              FROM stories o WHERE o.centroid IS NOT NULL AND o.updated_at >= now() - interval '30 days'
              ORDER BY o.centroid <#> (SELECT centroid FROM s) LIMIT $2 OFFSET 0),
    pool AS (SELECT DISTINCT ON (id) id, via, likeness FROM (SELECT * FROM mates UNION ALL SELECT * FROM close) x ORDER BY id, via)
    SELECT p.id, p.via, p.likeness, o.lang, o.id_thread, o.created_at, first.title, first.medium, first.at,
           (SELECT count(DISTINCT a.medium) FROM articles a WHERE a.id_story = p.id) AS media
    FROM pool p JOIN stories o ON o.id = p.id
    CROSS JOIN LATERAL (SELECT a.title, a.medium, COALESCE(a.published_at, a.created_at) AS at FROM articles a
                        WHERE a.id_story = p.id ORDER BY COALESCE(a.published_at, a.created_at) LIMIT 1) first
    ORDER BY first.at`, seed, per);
for (const r of rows) console.log(`${r.id}${r.id === seed ? '*' : ''} ${r.via === 'thread' ? 'T' : ' '} ${r.likeness.toFixed(2)} ${r.lang} ${r.at.toISOString().slice(5, 16)} m${r.media} | ${String(r.title).slice(0, 110)}`);
await prisma.$disconnect();
