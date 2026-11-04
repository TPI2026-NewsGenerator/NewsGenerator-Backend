// The watch of a followed affair replayed over the last days of the database: the affair is built as it is now, then
// reset to what it was DAYS ago (its events before that date), and checked step by step as the watch does (the
// stories created in each step, judged, joined to the events, the key ones read again, the alerts they give). Prints
// the alerts with their date, then the key events of the whole affair after that date, to read the two side by side:
// which alerts are wrong, which key events never rang. Writes nothing
//
//  node bench/affairs/replay.mjs <storyId> [--days=10] [--step=12] [--profile=7] [--close=250] [--max=300] [--json=file] [--dump]
import 'dotenv/config';
import process from 'node:process';
import {writeFileSync} from 'node:fs';
import {prisma} from '../../config/db.js';
import {AffairModel} from '../../models/affair-model.js';
import {ProfileModel} from '../../models/profile-model.js';
import {feedsOf} from '../../services/briefing-service.js';
import {buildAffair, CLOSE_LIKENESS, storiesWithNews} from '../../services/utils/affair.js';
import {checkAffair} from '../../services/utils/affair-watch.js';
import {readerLanguage} from '../../services/utils/language.js';
import {newUsage} from '../../services/utils/ollama.js';

const flags = Object.fromEntries(process.argv.filter(arg => arg.startsWith('--')).map(arg => arg.slice(2).split('=')));
const storyId = Number(process.argv.slice(2).find(arg => !arg.startsWith('--')));
const days = Number(flags.days ?? 10);
const stepHours = Number(flags.step ?? 12);
const profileId = Number(flags.profile ?? 7);
const DAY = 24 * 3600e3;

const profile = await ProfileModel.get(profileId);
const language = readerLanguage(profile);
const feedUrls = await feedsOf(profileId);
const [first] = await prisma.$queryRawUnsafe('SELECT title FROM articles WHERE id_story = $1 ORDER BY COALESCE(published_at, created_at) LIMIT 1', storyId);
const usage = newUsage();
const now = new Date();

console.log(`building the affair of story ${storyId} (${first?.title?.slice(0, 80)})`);
const full = await buildAffair({storyId, title: first?.title ?? `story ${storyId}`, language, feedUrls, usage,
    closePerStory: Number(flags.close ?? 250), maxPool: Number(flags.max ?? 300)});
if (!full.affair) {
    console.log('not an affair');
    process.exit(0);
}
console.log(`AFFAIR: ${full.title} — ${full.events.length} events, ${full.events.filter(e => e.kind === 'key').length} key`);

// the affair as it was DAYS ago: its events before, all of them known (none rings for what the reader had)
const start = new Date(+now - days * DAY);
const known = full.events.filter(event => new Date(event.at) < start).map(event => ({...event, asked: true, alerted: false}));
const after = full.events.filter(event => new Date(event.at) >= start);
console.log(`at ${start.toISOString().slice(0, 16)}: ${known.length} events known, ${after.length} came after (${after.filter(e => e.kind === 'key').length} key)`);
if (flags.dump) {
    console.log('KNOWN, the last ones:');
    for (const event of known.slice(-12)) console.log(`  ${event.at.slice(5, 16)} ${event.kind === 'key' ? 'KEY' : '   '} m${String(event.media.length).padStart(3)} | ${(event.titleTranslation ?? event.title).slice(0, 110)}`);
    console.log('AFTER (all, in the whole affair):');
    for (const event of after) console.log(`  ${event.at.slice(5, 16)} ${event.kind === 'key' ? 'KEY' : '   '} m${String(event.media.length).padStart(3)} | ${(event.titleTranslation ?? event.title).slice(0, 110)}`);
}
let state = {
    title: full.title, language, about: full.about, not_about: full.not ?? '',
    story_ids: [...new Set(known.flatMap(event => event.storyIds))],
    view: {events: known, coverage: null},
};
if (state.story_ids.length === 0) {
    console.log('nothing known at the start: take fewer days');
    process.exit(0);
}

const rings = [];
const month = new Date(+now - 30 * DAY);
for (let at = +start; at < +now; at += stepHours * 3600e3) {
    const until = new Date(Math.min(at + stepHours * 3600e3, +now));
    const rows = await AffairModel.fresh({storyIds: state.story_ids, threadIds: await AffairModel.threadsOf(state.story_ids),
        since: new Date(at), until, excluded: state.story_ids, likeness: CLOSE_LIKENESS, limit: 120});
    const fresh = rows.length === 0 ? [] : await storiesWithNews(rows.map(row => ({id: row.id, via: 'fresh', likeness: row.likeness})), feedUrls, month);
    const held = new Map((await storiesWithNews(state.story_ids.map(id => ({id, via: 'held', likeness: 1})), feedUrls, month)).map(story => [story.storyId, story]));
    const result = await checkAffair({affair: state, fresh, held, now: until, usage});
    state = {...state, story_ids: result.stored, view: {events: result.events, coverage: result.coverage}};
    console.log(`${until.toISOString().slice(5, 16)}  ${String(rows.length).padStart(3)} close, ${String(fresh.length).padStart(3)} read, ${String(result.accepted).padStart(3)} in, ${result.promoted} promoted, ${result.alerts.length} ring`);
    for (const alert of result.alerts) {
        rings.push({checkedAt: until.toISOString(), ...alert});
        console.log(`      RING ${alert.at.slice(5, 16)} m${String(alert.media.length).padStart(3)} ${alert.official ? 'OFFICIAL ' : ''}${alert.denial ? 'CONTESTED ' : ''}| ${(alert.titleTranslation ?? alert.title).slice(0, 110)}`);
    }
}

console.log(`\n${rings.length} alerts in ${days} days (${(rings.length / days).toFixed(2)} a day); tokens ${JSON.stringify(usage)}`);
console.log('\nKEY EVENTS OF THE WHOLE AFFAIR AFTER THE START (what a perfect watch could ring):');
for (const event of after.filter(e => e.kind === 'key')) {
    const rang = rings.some(ring => ring.storyIds.some(id => event.storyIds.includes(id)));
    console.log(`  ${rang ? 'rang   ' : 'silent '} ${event.at.slice(5, 16)} m${String(event.media.length).padStart(3)} | ${(event.titleTranslation ?? event.title).slice(0, 110)}`);
}
if (flags.json) writeFileSync(flags.json, JSON.stringify({rings, after: after.map(e => ({at: e.at, kind: e.kind, title: e.titleTranslation ?? e.title, media: e.media.length, storyIds: e.storyIds}))}, null, 1));
await prisma.$disconnect();
