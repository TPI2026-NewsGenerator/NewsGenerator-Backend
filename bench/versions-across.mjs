// The versions of a fact in the other languages (StoryModel.versionsAcross) of the stories a reader's
// briefing ranks first: how many, how close, how long the query takes, with the titles to judge them.
// Read only.
//   node --env-file=.env bench/versions-across.mjs [userId=482] [stories=30] [likeness=0.7] [perStory=5]
import {rss} from '../db/rss-links.js';
import {StoryModel} from '../models/story-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {readerLanguage} from '../services/utils/language.js';

const [userId = 482, count = 30, likeness = 0.7, perStory = 5] = process.argv.slice(2).map(Number);
const since = new Date(Date.now() - 48 * 3600e3);
const profile = await ProfileModel.get(userId);
const language = readerLanguage(profile);
const shared = Object.values(rss).flatMap(c => Object.values(c).flat());
const feedUrls = [...new Set([...shared, ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])];
const ranked = (await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: count}));
const storyIds = ranked.map(r => r.id_story);

const started = Date.now();
const rows = await StoryModel.versionsAcross({storyIds, language, feedUrls, since, likeness, perStory});
const seconds = (Date.now() - started) / 1000;
const ids = [...new Set([...storyIds, ...rows.map(r => r.id_version)])];
const news = await StoryModel.storyArticles({storyIds: ids, feedUrls, since});
const titleOf = (id) => news.find(a => a.id_story === id);
console.log(`${rows.length} versions for ${storyIds.length} stories in ${seconds} s (likeness >= ${likeness}, ${perStory} per story)`);
for (const id of storyIds) {
    const versions = rows.filter(r => r.id_story === id);
    if (versions.length === 0) continue;
    const lead = titleOf(id);
    console.log(`\n[${lead?.lang}] ${lead?.title}`);
    for (const v of versions) {
        const a = titleOf(v.id_version);
        console.log(`   ${v.likeness.toFixed(3)} [${a?.lang}] ${a?.title}`);
    }
}
process.exit(0);
