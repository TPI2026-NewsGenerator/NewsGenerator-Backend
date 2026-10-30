// How often each "Its sources" label was given on the cards of the briefings (read only)
import {prisma} from '../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(item->>'sourcing', 'null') AS sourcing, count(*)::int AS cards
    FROM briefings b, jsonb_array_elements(b.items) AS item
    WHERE b.status = 'ready'
    GROUP BY 1 ORDER BY 2 DESC`);
console.log(rows);
const anonymous = await prisma.$queryRawUnsafe(`
    SELECT b.id_user, item->>'title' AS title, item->>'sourcing' AS sourcing
    FROM briefings b, jsonb_array_elements(b.items) AS item
    WHERE b.status = 'ready' AND item->>'sourcing' IN ('anonymous', 'none')
    ORDER BY b.created_at DESC LIMIT 12`);
console.log(anonymous.map(row => `${row.sourcing.padEnd(9)} ${row.title.slice(0, 100)}`).join('\n'));
await prisma.$disconnect();
