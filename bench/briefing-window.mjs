// What a briefing would choose from over 2, 7 and 30 days for a user (env USER_ID): the stories ranked
// on their interests (rank_stories), how long it takes, and how many affairs (threads) they are. Read only
import {rss} from '../db/rss-links.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {prisma} from '../config/db.js';

const userId = Number(process.env.USER_ID);
const feedUrls = [...new Set([
    ...Object.values(rss).flatMap(categories => Object.values(categories).flat()),
    ...await FeedModel.userFeedUrls(userId),
    ...await searchesOfUser(userId),
])];
for (const days of [2, 7, 30]) {
    const since = new Date(Date.now() - days * 24 * 3600e3);
    const started = Date.now();
    const ranked = await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.1, limit: 150});
    const ms = Date.now() - started;
    const ids = ranked.map(row => row.id_story);
    const stories = await prisma.$queryRawUnsafe(`
        SELECT s.id, s.id_thread, a.title, COALESCE(a.published_at, a.created_at) AS at
        FROM stories s JOIN LATERAL (SELECT title, published_at, created_at FROM articles WHERE id_story = s.id
            ORDER BY COALESCE(published_at, created_at) LIMIT 1) a ON true
        WHERE s.id = ANY($1::int[])`, ids);
    const byId = new Map(stories.map(story => [story.id, story]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    const threads = (list) => new Set(list.map(story => story.id_thread ?? `s${story.id}`)).size;
    const ageDays = (list) => list.map(story => (Date.now() - new Date(story.at)) / 864e5);
    const old = (list, d) => ageDays(list).filter(age => age > d).length;
    console.log(`\n=== ${days} days: ranked ${ranked.length} in ${ms} ms; top 40: ${threads(ordered.slice(0, 40))} affairs, `
        + `${old(ordered.slice(0, 40), 2)} older than 2 days, ${old(ordered.slice(0, 40), 7)} older than 7; top 150: ${threads(ordered)} affairs`);
    for (const story of ordered.slice(0, 12)) {
        console.log(`  ${new Date(story.at).toISOString().slice(5, 10)} t${story.id_thread ?? '-'} ${story.title.slice(0, 90)}`);
    }
}
await prisma.$disconnect();
