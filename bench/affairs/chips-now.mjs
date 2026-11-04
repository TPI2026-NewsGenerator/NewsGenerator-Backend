// Which cards of the latest briefings are an affair for the server (read only: the names are asked of the AI, nothing is written)
import 'dotenv/config';
import {prisma} from '../../config/db.js';
import {AffairService} from '../../services/affair-service.js';

const rows = await prisma.$queryRawUnsafe(`SELECT b.id, b.id_user, b.id_profile, b.created_at, jsonb_array_length(b.items) AS cards, u.username FROM briefings b JOIN users u ON u.id = b.id_user WHERE b.status = 'ready' ORDER BY b.id DESC LIMIT 6`);
for (const row of rows) {
    const t = Date.now();
    const chips = await AffairService.chips(row.id_user, row.id).catch(err => ({error: err.message}));
    console.log(`briefing ${row.id} ${row.username} p${row.id_profile} ${row.created_at.toISOString().slice(0, 16)} ${row.cards} cards: ${chips.error ?? Object.keys(chips).length + ' affairs'} (${Date.now() - t} ms)`,
        chips.error ? '' : Object.entries(chips).map(([id, c]) => `${id}${c.followed ? ' [followed ' + c.followed + ']' : ''}`).join(', '));
}
const followed = await prisma.$queryRawUnsafe(`SELECT id, id_user, title, created_at FROM affairs ORDER BY id`);
console.log('affairs followed in the database:', followed.map(a => `${a.id} user ${a.id_user} "${a.title.slice(0, 50)}" ${a.created_at.toISOString().slice(0, 16)}`));
await prisma.$disconnect();
