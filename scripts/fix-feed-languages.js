//
//  Author: Fabian Rostello
//  Date: 26.09.2026
//  File: fix-feed-languages.js
//  Description: The language of the feeds of the readers and of the directory read again from their
//               news. The feeds found before 26.09.2026 got the language of the search that found
//               their medium: tribuna.com/en/, found by a French search, was stored "fr". Before
//               1.10.2026 only 9 languages could be told, and feeds in Arabic, Turkish or Albanian of
//               the directory were taken for English or Italian. Feeds whose news do not tell their
//               language keep the one they have
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

// the feeds of a table with the languages stored for them and their last news
const feedsOf = (table) => prisma.$queryRawUnsafe(`
    SELECT uf.url, array_agg(DISTINCT uf.language) AS stored,
           (SELECT array_agg(t.text) FROM (
                SELECT a.title || ' ' || COALESCE(left(a.description, 400), '') AS text
                FROM articles a JOIN feeds f ON f.id = a.id_feed
                WHERE f.url = uf.url
                ORDER BY a.id DESC
                LIMIT $1::int) t) AS texts
    FROM ${table} uf
    GROUP BY uf.url`,
    NEWS_READ);

for (const [table, model, name] of [['user_feeds', prisma.user_feeds, 'readers'], ['directory_feeds', prisma.directory_feeds, 'directory']]) {
    const feeds = await feedsOf(table);
    const changes = feeds.flatMap(({url, stored, texts}) => {
        const language = feedLanguage(texts ?? [], url);
        return language && stored.some(value => value !== language) ? [{url, stored: stored.map(value => value ?? 'none').join(','), language}] : [];
    });

    console.log(`\n${feeds.length} feeds of the ${name}, ${changes.length} with another language in their news`);
    if (changes.length > 0) console.table(changes.map(change => ({...change, url: change.url.slice(0, 90)})));

    if (apply) {
        let updated = 0;
        for (const {url, language} of changes) {
            updated += (await model.updateMany({where: {url}, data: {language}})).count;
        }
        console.log(`${updated} rows of ${table} updated`);
    } else if (changes.length > 0) {
        console.log('Nothing changed: run it again with --apply');
    }
}

await prisma.$disconnect();
