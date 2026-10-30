// The feeds findFeeds compares for a site when looking for the sources of a profile (env USER_ID,
// SITES comma separated, LANGUAGE): their news on the profile, judged, and the titles judged on it
import {ProfileModel} from '../models/profile-model.js';
import {parseVector, embed} from '../services/utils/embedder.js';
import {judgeOf, JUDGE_THRESHOLD} from '../services/utils/meaning-judge.js';
import {findFeeds} from '../services/utils/feed-finder.js';
import {prisma} from '../config/db.js';

const interests = await ProfileModel.interestsForDiscovery(Number(process.env.USER_ID));
const cache = new Map();
const judge = judgeOf(interests.map(interest => parseVector(interest.dense)), cache);
for (const site of process.env.SITES.split(',')) {
    const interest = interests[0];
    const subject = [interest.keywords, ...interest.sections].filter(Boolean);
    const feeds = await findFeeds(site, {language: process.env.LANGUAGE ?? 'en', subject, judge});
    console.log(`\n${site}`);
    for (const feed of feeds.slice(0, 6)) console.log(`  ${feed.onSubject}/${feed.judged} on subject, ${feed.onSubjectPerDay?.toFixed?.(2)}/day  ${feed.url.slice(0, 90)}`);
    // the titles of the first one judged on the profile
    const first = feeds[0];
    if (first?.items?.length) console.log('   (items not kept by findFeeds)');
}
console.log(`threshold ${JUDGE_THRESHOLD}, cached texts ${cache.size}`);
// the titles judged on the profile, with their best likeness
const denses = interests.map(interest => parseVector(interest.dense));
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const on = [...cache].map(([text, vector]) => ({text, best: Math.max(...denses.map(d => dot(vector, d)))})).filter(row => row.best >= JUDGE_THRESHOLD).sort((a, b) => b.best - a.best);
for (const row of on.slice(0, 40)) console.log(`${row.best.toFixed(3)} ${row.text.slice(0, 110)}`);
await prisma.$disconnect();
process.exit(0);
