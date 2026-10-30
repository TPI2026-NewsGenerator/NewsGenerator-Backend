// How long GET /profile takes for a user (env USER_ID) and how big its answer is. Writes nothing
import {prisma} from '../config/db.js';
import {ProfileService} from '../services/profile-service.js';
import {FeedService} from '../services/feed-service.js';

const userId = Number(process.env.USER_ID);
for (let i = 0; i < 3; i++) {
    const start = Date.now();
    const answer = await ProfileService.get(userId);
    console.log(`profile: ${Date.now() - start} ms, ${JSON.stringify(answer).length} chars, ${answer.sources.length} sources, status ${answer.profile.discovery.status}`);
}
const start = Date.now();
const feeds = await FeedService.listUserFeeds?.(userId);
if (feeds) console.log(`feeds: ${Date.now() - start} ms, ${feeds.length}`);
await prisma.$disconnect();
process.exit(0);
