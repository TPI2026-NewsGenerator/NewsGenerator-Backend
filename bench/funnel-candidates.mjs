// The stories ranked for a reader that were credible but did not become candidates of the AI, and why.
//   node --env-file=.env bench/funnel-candidates.mjs <userId>
import process from 'node:process';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, isGoogleNewsUrl, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';

const userId = Number(process.argv[2]);
const profile = await ProfileModel.get(userId);
const refused = new Set((await FeedbackService.of(userId)).refused);
const feedUrls = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()),
    ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])].filter(u => !refused.has(u));
const since = new Date(Date.now() - 48 * 3600e3);
const ranked = await StoryModel.rank({userId, feedUrls, since, languages: profile.languages, sparseWeight: 0.5, limit: 150});
const members = new Map(ranked.map(r => [r.id_story, []]));
for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
const media = new Set(await FeedModel.feedMedia());
const stories = ranked.map((r, rank) => {
    const news = members.get(r.id_story);
    return {rank: rank + 1, storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], members: news, score: Number(r.score)};
});
const onlyGoogle = s => s.members.every(a => isGoogleNewsUrl(a.feed_url));
const dropped = stories.filter(s => !(s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members)));
console.log('not credible:', dropped.map(s => `#${s.rank} ${s.best ? (credibleStory(s.members, media) ? 'repeated page' : 'Google alone, 1 unknown medium') : 'no article'}: ${s.best?.title.slice(0, 70)}`));
const credible = stories.filter(s => !dropped.includes(s));
const cands = new Set(pickCandidates(credible, {fromFeeds: 40, extra: 10, perMedium: 2}));
const fromFeeds = credible.filter(s => !onlyGoogle(s)), google = credible.filter(onlyGoogle);
console.log(`credible ${credible.length}: told by a feed ${fromFeeds.length}, Google alone ${google.length}; candidates ${cands.size} (Google alone ${[...cands].filter(onlyGoogle).length})`);
const out = credible.filter(s => !cands.has(s));
console.log(`last candidate from feeds: #${fromFeeds[39]?.rank} score ${fromFeeds[39]?.score.toFixed(3)}; first left out: #${out[0]?.rank} ${out[0]?.score.toFixed(3)}; last: #${out.at(-1)?.rank} ${out.at(-1)?.score.toFixed(3)}`);
const gl = google.filter(s => !cands.has(s));
console.log(`Google alone left out ${gl.length}`, gl.map(s => `#${s.rank} ${s.best.medium}`).join(', '));
console.log('left out, by rank:');
for (const s of out) console.log(`  #${s.rank} ${s.score.toFixed(3)} ${onlyGoogle(s) ? 'G' : 'F'} [${s.best.medium}] ${s.best.title.slice(0, 90)} (${new Set(s.members.map(a => a.medium)).size} media)`);
process.exit(0);
