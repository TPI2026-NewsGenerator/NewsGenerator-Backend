// How much the shared feeds of db/rss-links.js bring: how many there are, their share of the news read
// in the last 24 hours, and for the briefings of a user (env USER_ID, its LAST briefings), how many
// articles of their cards came from them, from the feeds of the user, or from Google News
import {rss} from '../db/rss-links.js';
import {prisma} from '../config/db.js';
import {FeedModel} from '../models/feed-model.js';

const userId = Number(process.env.USER_ID);
const LAST = Number(process.env.LAST ?? 3);
const shared = new Set(Object.values(rss).flatMap(categories => Object.values(categories).flat()));
const own = new Set(await FeedModel.userFeedUrls(userId));
console.log(`shared feeds in rss-links.js: ${shared.size}, feeds of user ${userId}: ${own.size}, in both: ${[...own].filter(url => shared.has(url)).length}`);

const day = await prisma.$queryRawUnsafe(`
    SELECT f.url, count(*)::int AS n FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.created_at > now() - interval '24 hours' GROUP BY f.url`);
const total = day.reduce((sum, row) => sum + row.n, 0);
const fromShared = day.filter(row => shared.has(row.url)).reduce((sum, row) => sum + row.n, 0);
const google = day.filter(row => row.url.startsWith('https://news.google.com/')).reduce((sum, row) => sum + row.n, 0);
console.log(`news of the last 24 h: ${total}, from rss-links.js ${fromShared} (${Math.round(100 * fromShared / total)}%), Google News ${google}`);

const briefings = await prisma.briefings.findMany({where: {id_user: userId, status: 'ready'}, orderBy: {id: 'desc'}, take: LAST});
for (const briefing of briefings) {
    const counts = {shared: 0, own: 0, both: 0, google: 0, other: 0};
    let cardsWithShared = 0;
    for (const item of briefing.items ?? []) {
        const urls = item.feedUrls ?? [];
        if (urls.some(url => shared.has(url))) cardsWithShared++;
        for (const url of urls) {
            const kind = shared.has(url) && own.has(url) ? 'both' : shared.has(url) ? 'shared' : own.has(url) ? 'own'
                : url.startsWith('https://news.google.com/') ? 'google' : 'other';
            counts[kind]++;
        }
    }
    console.log(`briefing ${briefing.id}: ${briefing.items?.length ?? 0} cards, ${cardsWithShared} with a feed of rss-links.js; feeds of the cards: ${JSON.stringify(counts)}`);
}
await prisma.$disconnect();
