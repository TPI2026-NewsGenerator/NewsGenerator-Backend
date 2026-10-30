// What DirectoryService.prune would take out of the directory now, through the real queries. Writes nothing
import {prisma} from '../config/db.js';
import {DirectoryModel} from '../models/directory-model.js';
import {uselessFeeds} from '../services/directory-service.js';
import {JUDGE_THRESHOLD} from '../services/utils/meaning-judge.js';

const readers = await DirectoryModel.readers(14);
console.log('readers', JSON.stringify(readers));
let started = Date.now();
const rows = await DirectoryModel.usage({usedDays: 14, newsDays: 3, threshold: JUDGE_THRESHOLD});
console.log(`usage: ${rows.length} feeds in ${Math.round((Date.now() - started) / 1000)} s`);

const sum = (list) => list.reduce((total, row) => total + row.news, 0);
const now = useless => ({feeds: useless.length, newsOf3Days: sum(useless)});
const today = uselessFeeds(rows, {followed: readers.categories});
const later = uselessFeeds(rows, {followed: readers.categories, graceDays: 0});
console.log('all', {feeds: rows.length, newsOf3Days: sum(rows), used: rows.filter(row => row.used).length});
console.log('taken out today', now(today));
console.log('taken out once all are 14 days old (same news)', now(later));
console.log('by reason today', Object.entries(Object.groupBy(today, row => row.reason.startsWith('a section') ? 'section' : 'share')).map(([k, v]) => `${k} ${v.length}`).join(', '));
for (const row of today.sort((a, b) => b.news - a.news).slice(0, 15)) console.log(' -', row.medium, row.news, row.relevant);
const out = new Set(later.map(row => row.url));
const kept = rows.filter(row => !out.has(row.url) && !row.used && row.news > 0);
console.log('kept without a briefing (share >= 11%)', now(kept));
for (const row of kept.sort((a, b) => b.relevant - a.relevant).slice(0, 15)) console.log(' -', row.medium, row.news, row.relevant);
await prisma.$disconnect();
process.exit(0);
