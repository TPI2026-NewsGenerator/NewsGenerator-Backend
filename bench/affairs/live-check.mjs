// A real follow and a real check of the watch against the database, then everything it made is deleted. It WRITES to the database
// (the tables of add_affairs.sql): a follow, the affair set back two days, the check, then its removal with its alerts. For the user's
// own account (user 4 by default): a briefing of theirs with a card that is an affair. Only this affair is checked, never the others
//
//  node bench/affairs/live-check.mjs [userId] [--keep]
import 'dotenv/config';
import process from 'node:process';
import {prisma} from '../../config/db.js';
import {AffairModel} from '../../models/affair-model.js';
import {AffairService} from '../../services/affair-service.js';
import {feedsOf} from '../../services/briefing-service.js';
import {watchAffair} from '../../services/utils/affair-watch.js';
import {ProfileModel} from '../../models/profile-model.js';
import {newUsage} from '../../services/utils/ollama.js';

const userId = Number(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 4);
const keep = process.argv.includes('--keep');
const briefings = await prisma.$queryRawUnsafe(`SELECT id, id_profile, created_at, jsonb_array_length(items) AS cards FROM briefings WHERE id_user = $1 AND status = 'ready' ORDER BY id DESC LIMIT 5`, userId);
console.log('briefings of the user', userId, briefings.map(b => `${b.id} (${b.cards} cards, ${b.created_at.toISOString().slice(0, 10)})`).join(', ') || 'none');
let target = null;
for (const briefing of briefings) {
    const chips = await AffairService.chips(userId, briefing.id);
    const ids = Object.keys(chips);
    console.log(`  briefing ${briefing.id}: ${ids.length} affairs`, ids.map(id => `${id} "${chips[id].title.slice(0, 60)}"`).join('; '));
    if (ids.length > 0) {
        target = {briefingId: briefing.id, storyId: Number(ids[0]), profileId: briefing.id_profile};
        break;
    }
}
if (!target) {
    console.log('no card of this user is an affair: nothing tested');
    await prisma.$disconnect();
    process.exit(0);
}

let id = null;
try {
    const followed = await AffairService.follow(userId, target.briefingId, target.storyId);
    id = followed.id;
    console.log('FOLLOWED', followed);
    console.log('followed again ->', await AffairService.follow(userId, target.briefingId, target.storyId));
    const [row] = await prisma.$queryRawUnsafe('SELECT story_ids, checked_at, view FROM affairs WHERE id = $1', id);
    console.log(`stored: ${row.view.events.length} events, ${row.story_ids.length} stories, checked_at ${row.checked_at.toISOString()}`);

    // the affair as it was 2 days ago, to give the watch something to find: the events since are taken out and the date set back
    const since = new Date(Date.now() - 2 * 24 * 3600e3);
    const kept = row.view.events.filter(event => new Date(event.at) < since);
    const storyIds = [...new Set(kept.flatMap(event => event.storyIds))];
    await prisma.$executeRawUnsafe(`UPDATE affairs SET view = $2::jsonb, story_ids = $3::int[], checked_at = $4::timestamptz WHERE id = $1`,
        id, JSON.stringify({...row.view, events: kept, countedAt: since.toISOString()}), storyIds, since);
    console.log(`rewound to ${since.toISOString().slice(0, 16)}: ${kept.length} events kept, ${row.view.events.length - kept.length} to find again`);

    // the check of this affair only
    const affair = await AffairModel.followedOne(userId, id);
    const usage = newUsage();
    const started = Date.now();
    const result = await watchAffair({...affair, id_user: userId}, {feedUrls: await feedsOf(target.profileId ?? (await ProfileModel.idsOf(userId))[0]), usage});
    console.log(`WATCH in ${Math.round((Date.now() - started) / 1000)} s: ${result.accepted} stories in, ${result.alerts.length} alerts, tokens ${JSON.stringify(usage)}`);
    const detail = await AffairService.detail(userId, id);
    console.log(`after: ${detail.events.length} events, ${detail.alerts.length} alerts, last event ${detail.lastEventAt}`);
    for (const alert of detail.alerts) console.log(`  ALERT ${alert.event.at.slice(5, 16)} m${alert.event.media.length} ${alert.read ? 'read' : 'new'} | ${(alert.event.titleTranslation ?? alert.event.title).slice(0, 100)}`);
    console.log('list:', JSON.stringify((await AffairService.list(userId)).affairs.map(a => ({id: a.id, unread: a.unread, events: a.events}))));
    console.log('unread:', await AffairService.unread(userId));
    await AffairService.seen(userId, id);
    console.log('unread after seen:', await AffairService.unread(userId));
} finally {
    if (id !== null && !keep) {
        await AffairService.unfollow(userId, id);
        const [left] = await prisma.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM affairs WHERE id = $1) AS affairs, (SELECT count(*)::int FROM affair_alerts WHERE id_affair = $1) AS alerts', id);
        console.log('UNFOLLOWED, left in the database:', left);
    }
    await prisma.$disconnect();
}
