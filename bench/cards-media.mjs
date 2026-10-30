// Read only: how many cards of the briefings of the last days were told by 2 media or more, per reader,
// and the thumbs given to the cards of one medium against the others. Answers whether a minimum of
// media in the profile would leave a briefing empty.
//   node --env-file=.env bench/cards-media.mjs [days]
import process from 'node:process';
import {prisma} from '../config/db.js';

const days = Number(process.argv[2] ?? 14);
const rows = await prisma.$queryRawUnsafe(`
    SELECT id_user, hours, items FROM briefings
    WHERE status = 'ready' AND created_at > now() - make_interval(days => $1)`, days);

const byUser = new Map();
const thumbs = {one: {up: 0, down: 0}, more: {up: 0, down: 0}};
for (const row of rows) {
    const user = byUser.get(row.id_user) ?? {briefings: 0, cards: 0, two: 0, indep2: 0, emptyAt2: 0, under5At2: 0};
    user.briefings++;
    const items = Array.isArray(row.items) ? row.items : [];
    const two = items.filter(item => (item.corroboration?.media ?? 0) >= 2).length;
    user.cards += items.length;
    user.two += two;
    user.indep2 += items.filter(item => (item.corroboration?.independent ?? 0) >= 2).length;
    if (two === 0) user.emptyAt2++;
    if (two < 5) user.under5At2++;
    byUser.set(row.id_user, user);
    for (const item of items) {
        if (!item.vote) continue;
        thumbs[(item.corroboration?.media ?? 0) >= 2 ? 'more' : 'one'][item.vote]++;
    }
}

let all = {briefings: 0, cards: 0, two: 0, indep2: 0, emptyAt2: 0, under5At2: 0};
for (const [user, s] of [...byUser].sort((a, b) => b[1].cards - a[1].cards)) {
    console.log(`user ${user}: ${s.briefings} briefings, ${s.cards} cards, 2+ media ${s.two} (${Math.round(100 * s.two / s.cards)}%), 2+ independent ${s.indep2}, briefings left empty at 2 ${s.emptyAt2}, under 5 cards ${s.under5At2}`);
    for (const key of Object.keys(all)) all[key] += s[key];
}
console.log(`all: ${all.briefings} briefings, ${all.cards} cards, 2+ media ${all.two} (${Math.round(100 * all.two / all.cards)}%), 2+ independent ${all.indep2} (${Math.round(100 * all.indep2 / all.cards)}%), empty at 2 ${all.emptyAt2}, under 5 cards ${all.under5At2}`);
console.log('thumbs', JSON.stringify(thumbs));
await prisma.$disconnect();
