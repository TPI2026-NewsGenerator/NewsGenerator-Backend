// how the ranked stories and the candidates of a reader spread over their interests, now, without the AI
// node bench/balance.mjs <userId> [titles]
import 'dotenv/config';
import {rss} from '../db/rss-links.js';
import {StoryModel} from '../models/story-model.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, pickCandidates} from '../services/utils/google-news.js';

const userId = Number(process.argv[2]);
const profile = await ProfileModel.get(userId);
const interests = await ProfileModel.interests(userId);
const since = new Date(Date.now() - 48 * 3600e3);
const feedUrls = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()), ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])];
const ranked = await StoryModel.rank({userId, feedUrls, since, languages: profile.languages, sparseWeight: 0.5, excluded: [], limit: 150});
const members = new Map(ranked.map(r => [r.id_story, []]));
for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
const media = new Set(await FeedModel.feedMedia());
const stories = ranked.map(r => ({storyId: r.id_story, interest: r.id_interest, score: Number(r.score), best: members.get(r.id_story).find(a => a.id === r.id_article), members: members.get(r.id_story)}));
const credible = stories.filter(s => s.best && credibleStory(s.members, media));
const candidates = pickCandidates(credible, {fromFeeds: 40, extra: 10, perMedium: 2});
const count = (list) => interests.map(i => list.filter(s => s.interest === i.id).length).join(' / ');
console.log(interests.map(i => `[${i.id}] ${i.text.slice(0, 40)}`).join(' | '));
console.log(`ranked 150: ${count(stories)}   credible: ${count(credible)}   candidates ${candidates.length}: ${count(candidates)}`);
for (const i of interests) {
    const own = credible.filter(s => s.interest === i.id);
    console.log(`[${i.id}] best ${own[0]?.score.toFixed(3)} 10th ${own[9]?.score.toFixed(3)} rank of its 1st/5th: ${credible.indexOf(own[0])}/${credible.indexOf(own[4])}`);
    if (process.argv[3]) own.slice(0, 12).forEach(s => console.log(`   ${s.score.toFixed(3)} ${candidates.includes(s) ? 'C' : ' '} ${s.best.title.slice(0, 90)}`));
}
process.exit(0);
