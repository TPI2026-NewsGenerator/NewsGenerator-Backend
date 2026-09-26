//
//  Author: Fabian Rostello
//  Date: 26.09.2026
//  File: fix-feed-languages.js
//  Description: The language of the feeds of the readers read again from their news. The feeds found
//               before 26.09.2026 got the language of the search that found their medium:
//               tribuna.com/en/, found by a French search, was stored "fr". Feeds whose news do not
//               tell their language keep the one they have
//
//  node scripts/fix-feed-languages.js            (shows what would change)
//  node scripts/fix-feed-languages.js --apply    (changes it)
//

import 'dotenv/config';
import process from 'node:process';
import {prisma} from '../config/db.js';
import {feedLanguage} from '../services/utils/language.js';

const NEWS_READ = 30;       // the last news of each feed, as when a feed is found (see feedLanguage)
const apply = process.argv.includes('--apply');

const feeds = await prisma.$queryRawUnsafe(`
    SELECT uf.url, array_agg(DISTINCT uf.language) AS stored,
           (SELECT array_agg(t.text) FROM (
                SELECT a.title || ' ' || COALESCE(left(a.description, 400), '') AS text
                FROM articles a JOIN feeds f ON f.id = a.id_feed
                WHERE f.url = uf.url
                ORDER BY a.id DESC
                LIMIT $1::int) t) AS texts
    FROM user_feeds uf
    GROUP BY uf.url`,
    NEWS_READ);

const changes = feeds.flatMap(({url, stored, texts}) => {
    const language = feedLanguage(texts ?? []);
    return language && stored.some(value => value !== language) ? [{url, stored: stored.map(value => value ?? 'none').join(','), language}] : [];
});

console.log(`${feeds.length} feeds of the readers, ${changes.length} with another language in their news`);
if (changes.length > 0) console.table(changes.map(change => ({...change, url: change.url.slice(0, 90)})));

if (apply) {
    let updated = 0;
    for (const {url, language} of changes) {
        updated += (await prisma.user_feeds.updateMany({where: {url}, data: {language}})).count;
    }
    console.log(`${updated} rows of user_feeds updated`);
} else if (changes.length > 0) {
    console.log('Nothing changed: run it again with --apply');
}

await prisma.$disconnect();
