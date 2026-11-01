// The tab of what a profile follows with a long list (the user, 2.11.2026: 3 minutes at most for about 300
// names), as the page asks for it: ITEMS items of Wikidata (default 200) and WORDS names or words as written
// (default 100: persons the tagger met, ten surnames alone, ten generic words) taken among the names the
// tagger met, a sample of the famous and the rare, searched for LIMIT news each (100 by default) over the
// feeds of the profile PROFILE_ID, the progress told every 10 s. What the profile follows and its briefing are
// stubbed: nothing is written. Read only
import {prisma} from '../config/db.js';
import {BriefingModel} from '../models/briefing-model.js';
import {EntityModel} from '../models/entity-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {followingNews} from '../services/briefing-service.js';

const profileId = Number(process.env.PROFILE_ID ?? 7);
const itemsWanted = Number(process.env.ITEMS ?? 200);
const wordsWanted = Number(process.env.WORDS ?? 100);
const limit = Number(process.env.LIMIT ?? 100);

const linked = await prisma.$queryRawUnsafe(`
    SELECT qid, name FROM (SELECT DISTINCT ON (qid) qid, name FROM mentions
                           WHERE qid IS NOT NULL AND kind IN ('person', 'organization') AND seen >= 3 AND length(name) BETWEEN 4 AND 40
                           ORDER BY qid, seen DESC) t
    ORDER BY md5(qid) LIMIT $1`, itemsWanted);
const items = linked.map((row, i) => ({id: i + 1, qid: row.qid, label: row.name, description: null, kind: 'person', names: [row.name],
    fetched_at: new Date(), added_names: [], removed_names: [], in_briefing: true, links: 0}));
const GENERIC = ['VAR', 'derby', 'penalty', 'offside', 'LFF', 'transfer', 'referee', 'goal', 'press', 'coach'];
const persons = (await prisma.$queryRawUnsafe(`
    SELECT name FROM mentions WHERE qid IS NULL AND kind = 'person' AND seen BETWEEN 1 AND 300 AND length(name) BETWEEN 6 AND 30 AND name ~ ' '
    ORDER BY md5(key) LIMIT $1`, Math.max(0, wordsWanted - 20))).map(row => row.name);
const surnames = persons.slice(0, 10).map(name => name.split(' ').at(-1));
const words = [...persons, ...surnames, ...GENERIC].slice(0, wordsWanted);
console.log(`${items.length} items (${items.slice(0, 3).map(item => item.label).join(' / ')}…) and ${words.length} words (${words.slice(0, 3).join(' / ')}…), ${limit} news each`);

EntityModel.followed = async () => items;
ProfileModel.get = async () => ({id: profileId, watch_terms: words, text: 'football', languages: ['en']});
BriefingModel.latest = async () => null;
BriefingModel.watched = async () => {};

const started = Date.now();
let answer = await followingNews(profileId, limit);
const timer = setInterval(() => console.log(`  ${Math.round((Date.now() - started) / 1000)} s: ${answer.status} ${answer.progress ? `${answer.progress.finished} of ${answer.progress.total} names` : ''}`), 10000);
while (answer.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    answer = await followingNews(profileId, limit);
}
clearInterval(timer);
const seconds = Math.round((Date.now() - started) / 1000);
const spans = new Map();
for (const group of answer.groups) spans.set(group.hours / 24, (spans.get(group.hours / 24) ?? 0) + 1);
console.log(`ready in ${seconds} s, partial ${answer.partial}: ${answer.groups.length} groups, ${Math.round(JSON.stringify(answer).length / 1024)} KB`);
console.log(`names by the days they went back: ${[...spans].sort((a, b) => a[0] - b[0]).map(([days, n]) => `${days} d ${n}`).join(', ')}`);
console.log(`names with news: ${answer.groups.filter(group => group.count > 0).length}, with the ${limit} wanted: ${answer.groups.filter(group => group.count >= limit).length}`);
for (const word of GENERIC.slice(0, 4)) {
    const group = answer.groups.find(found => found.term === word && !found.qid);
    if (group) console.log(`  “${word}”: ${group.count} stories in ${group.hours / 24} d`);
}
process.exit(0);
