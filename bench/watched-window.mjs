// What the news of what a profile follows cost over 2, 7 and 30 days, and how many there are (env
// PROFILE_ID; without it, the profiles that follow "Rosetti" or "Čeferin" are listed), then as the
// briefing reads them: the window growing until each has LIMIT news wanted (100 by default, env LIMIT).
// FIXED=0 skips the first part (the 30 days of a word of three letters take a minute). Read only
import {prisma} from '../config/db.js';
import {feedsOf, followedNews, watchedNews} from '../services/briefing-service.js';
import {EntityService} from '../services/entity-service.js';

const profileId = Number(process.env.PROFILE_ID);
if (!profileId) {
    const rows = await prisma.$queryRawUnsafe(`
        SELECT p.id, p.name, u.username, p.watch_terms,
               (SELECT array_agg(e.label) FROM profile_entities pe JOIN entities e ON e.id = pe.id_entity
                WHERE pe.id_profile = p.id AND pe.in_briefing) AS items
        FROM user_profiles p JOIN users u ON u.id = p.id_user
        WHERE EXISTS (SELECT 1 FROM unnest(p.watch_terms) t WHERE t ILIKE '%rosetti%' OR t ILIKE '%ceferin%' OR t ILIKE '%čeferin%')
           OR EXISTS (SELECT 1 FROM profile_entities pe JOIN entities e ON e.id = pe.id_entity
                      WHERE pe.id_profile = p.id AND (e.label ILIKE '%rosetti%' OR e.label ILIKE '%ceferin%' OR e.label ILIKE '%čeferin%'))`);
    console.log(JSON.stringify(rows, null, 1));
    process.exit(0);
}

// WORDS="VAR,UEFA": words to read instead of the ones of the profile (the cost of frequent ones)
const words = process.env.WORDS ? process.env.WORDS.split(',') : (await prisma.$queryRawUnsafe(`SELECT watch_terms FROM user_profiles WHERE id = $1`, profileId))[0].watch_terms;
const feedUrls = await feedsOf(profileId);
const size = (value) => `${Math.round(JSON.stringify(value).length / 1024)} KB`;
for (const days of process.env.FIXED === '0' ? [] : [2, 7, 30]) {
    const hours = days * 24;
    const since = new Date(Date.now() - hours * 3600e3);
    let started = Date.now();
    const items = await EntityService.briefingGroups(profileId, hours);
    const itemsMs = Date.now() - started;
    started = Date.now();
    const terms = await watchedNews(words, {feedUrls, since});
    const termsMs = Date.now() - started;
    console.log(`\n${days} days: items ${itemsMs} ms ${size(items)}, words ${termsMs} ms ${size(terms)}`);
    for (const group of [...items, ...terms]) {
        console.log(`  ${group.qid ?? 'word'} ${group.term}: ${group.count} stories, ${group.news.length} listed`);
    }
}

const limit = Number(process.env.LIMIT ?? 100);
const started = Date.now();
const groups = await followedNews(profileId, words, {feedUrls, limit});
console.log(`\nas the briefing reads them, ${limit} news wanted: ${Date.now() - started} ms ${size(groups)}`);
for (const group of groups) {
    console.log(`  ${group.qid ?? 'word'} ${group.term}: ${group.count} stories in ${group.hours / 24} days, ${group.news.length} listed`);
}
process.exit(0);
