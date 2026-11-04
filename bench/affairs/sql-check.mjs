// Read-only check of the SQL of the followed affairs against the real stories (the tables of add_affairs.sql are
// stood for by a CTE, nothing is written)
import 'dotenv/config';
import {prisma} from '../../config/db.js';

const [c] = await prisma.$queryRawUnsafe(`SELECT vector_dims(l2_normalize(avg(centroid))::halfvec(1024)) AS dims FROM stories WHERE id = ANY($1::int[]) AND centroid IS NOT NULL`, [1900910, 1901256, 1087358]);
console.log('centroid of stories', c);
const t = Date.now();
const rows = await prisma.$queryRawUnsafe(`
    WITH affairs AS (SELECT 1 AS id, l2_normalize(avg(centroid))::halfvec(1024) AS centroid FROM stories WHERE id = ANY($8::int[]))
    SELECT o.id, -(o.centroid <#> a.centroid)::real AS likeness
    FROM affairs a
    JOIN stories o ON o.updated_at >= $2::timestamptz AND o.created_at > $2::timestamptz AND o.created_at <= $3::timestamptz AND o.centroid IS NOT NULL
    WHERE a.id = $1::int AND a.centroid IS NOT NULL AND NOT o.id = ANY($4::int[])
      AND (o.id_thread = ANY($5::int[]) OR -(o.centroid <#> a.centroid) >= $6::real)
    ORDER BY o.centroid <#> a.centroid
    LIMIT $7::int`,
    1, new Date(Date.now() - 3 * 3600e3), new Date(), [1900910], [87335], 0.62, 50, [1900910, 1901256, 1087358]);
console.log(`fresh in ${Date.now() - t} ms:`, rows.length, rows.slice(0, 3));
await prisma.$disconnect();
