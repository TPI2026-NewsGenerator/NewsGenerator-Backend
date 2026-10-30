// The feed the discovery would keep for each site (env USER_ID, SITES comma separated, LANGUAGE), the
// news the vectors put on the profile, and the ones the AI confirms (confirmOnSubject)
import {ProfileModel} from '../models/profile-model.js';
import {parseVector} from '../services/utils/embedder.js';
import {judgeOf} from '../services/utils/meaning-judge.js';
import {findFeeds, isOnSubject} from '../services/utils/feed-finder.js';
import {confirmOnSubject} from '../services/utils/profile-ai.js';
import {prisma} from '../config/db.js';

const interests = await ProfileModel.interestsForDiscovery(Number(process.env.USER_ID));
const judge = judgeOf(interests.map(interest => parseVector(interest.dense)));
const subject = interests.flatMap(interest => [interest.keywords, ...interest.sections]).filter(Boolean);
for (const site of process.env.SITES.split(',')) {
    const feed = await findFeeds(site, {language: process.env.LANGUAGE ?? 'en', subject, judge}).then(feeds => feeds[0], () => null);
    if (!feed || !isOnSubject(feed)) { console.log(`\n${site}: no feed kept by the vectors (${feed?.onSubject ?? '-'}/${feed?.judged ?? '-'})`); continue; }
    const titles = feed.onSubjectTitles.slice(0, 12);
    const confirmed = await confirmOnSubject(interests.map(interest => interest.text), titles);
    console.log(`\n${site}: ${feed.onSubject}/${feed.judged} by vectors, AI ${confirmed ? confirmed.size : 'no answer'} of ${titles.length} -> ${confirmed && !isOnSubject({onSubject: confirmed.size}) ? 'LEFT OUT' : 'kept'}  ${feed.url.startsWith('http://rss-bridge') ? '(bridge)' : feed.url.slice(0, 80)}`);
    titles.forEach((title, i) => console.log(`   ${confirmed?.has(i) ? 'Y' : '-'} ${title.slice(0, 100)}`));
}
await prisma.$disconnect();
process.exit(0);
