// The relevance judged again by hand on the data of today (the 95 % of 24.09 were 4 invented profiles
// on a base half the size): for each reader, their interests, the 10 closest stories by the vectors
// alone (the candidates in their order) and the cards of a briefing written live, never saved.
// Writes a JSON to judge, read only
//   node --env-file=.env bench/relevance-now.mjs <out.json> [hours=48] userId...
import {writeFileSync} from 'node:fs';
import {rss} from '../db/rss-links.js';
import {write} from '../services/briefing-service.js';
import {BriefingModel} from '../models/briefing-model.js';
import {DiscoveryService} from '../services/discovery-service.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {shareOut} from '../services/utils/profile-ai.js';
import {credibleStory, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';

const [out, hoursArg, ...userArgs] = process.argv.slice(2);
const hours = Number(hoursArg ?? 48);
BriefingModel.step = async () => {};
DiscoveryService.prune = async () => {};
const shared = [...new Set(Object.values(rss).flatMap(c => Object.values(c).flat()))];
const media = new Set(await FeedModel.feedMedia());
const clip = (text, size) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, size);

const result = [];
const log = console.log;
for (const userId of userArgs.map(Number)) {
    const profile = await ProfileModel.get(userId);
    const interests = await ProfileModel.interests(userId);
    const feedback = await FeedbackService.of(userId);
    const refused = new Set(feedback.refused);
    const feedUrls = [...new Set([...shared, ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])].filter(u => !refused.has(u));
    const since = new Date(Date.now() - hours * 3600e3);

    // the vectors alone, as the briefing ranks them before the AI
    const ranked = shareOut(await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: 600}),
        150, row => row.id_interest, interests);
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const stories = ranked.map(r => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news, score: Number(r.score)};
    }).filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members));
    const candidates = pickCandidates(stories, {fromFeeds: 40, extra: 10, perMedium: 2,
        first: (list, size) => shareOut(list, size, s => s.interestId, interests)});
    const vectors = candidates.slice(0, 10).map(s => ({story: s.storyId, title: s.best.title, description: clip(s.best.description, 200)}));

    console.log = () => {};
    const started = Date.now();
    const items = await write(null, userId, hours).catch(err => ({error: err.message}));
    console.log = log;
    const cards = Array.isArray(items) ? items.map(item => ({
        title: item.title, source: item.lead?.source, why: item.why,
        passages: clip(item.summary?.translation || item.summary?.summary, 300),
    })) : items;
    log(`user ${userId}: ${vectors.length} by the vectors, ${Array.isArray(cards) ? cards.length : 'error'} cards in ${Math.round((Date.now() - started) / 1000)} s`);
    result.push({userId, profile: profile.text, interests: interests.map(i => i.text), refusedTopics: profile.refused ?? null, vectors, cards});
    writeFileSync(out, JSON.stringify(result, null, 1));
}
process.exit(0);
