// the candidates of a reader now that the patterns of isNotNews (used for Google News only) would find
// no news, on all their feeds: node bench/not-news-candidates.mjs <userId...>
import 'dotenv/config';
import {rss} from '../db/rss-links.js';
import {StoryModel} from '../models/story-model.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, isNotNews, pickCandidates} from '../services/utils/google-news.js';
const media = new Set(await FeedModel.feedMedia());
for (const userId of process.argv.slice(2).map(Number)) {
    const profile = await ProfileModel.get(userId);
    const since = new Date(Date.now() - 48 * 3600e3);
    const feedUrls = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()), ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])];
    const ranked = await StoryModel.rank({userId, feedUrls, since, languages: profile.languages, sparseWeight: 0.5, excluded: [], limit: 150});
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const stories = ranked.map(r => ({best: members.get(r.id_story).find(a => a.id === r.id_article), members: members.get(r.id_story)}));
    const candidates = pickCandidates(stories.filter(s => s.best && credibleStory(s.members, media)), {fromFeeds: 40, extra: 10, perMedium: 2});
    const flagged = candidates.filter(s => s.members.every(a => isNotNews(a.title, a.resolved_link ?? a.link)));
    console.log(`\nuser ${userId}: ${flagged.length} of ${candidates.length} candidates no news by the patterns`);
    flagged.forEach(s => console.log(`   ${s.best.title.slice(0, 100)}`));
}
process.exit(0);
