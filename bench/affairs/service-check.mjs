// The chips of the last briefing of a profile, then the view of the first one, through AffairService
import 'dotenv/config';
import {prisma} from '../../config/db.js';
import {AffairService} from '../../services/affair-service.js';

const profile = Number(process.argv[2] ?? 7);
const [row] = await prisma.$queryRawUnsafe(`SELECT id, id_user FROM briefings WHERE status = 'ready' AND id_profile = $1 ORDER BY id DESC LIMIT 1`, profile);
console.log('briefing', row);
let t = Date.now();
const chips = await AffairService.chips(row.id_user, row.id);
console.log(`chips in ${Date.now() - t} ms:`, JSON.stringify(chips, null, 1));
const first = Object.keys(chips)[0];
if (first) {
    t = Date.now();
    const view = await AffairService.view(row.id_user, row.id, first);
    console.log(`view in ${Date.now() - t} ms: ${view.affair ? `${view.events.length} events, ${view.coverage.media} media` : 'no affair'}`);
    t = Date.now();
    await AffairService.view(row.id_user, row.id, first);
    console.log(`again in ${Date.now() - t} ms`);
}
await prisma.$disconnect();
