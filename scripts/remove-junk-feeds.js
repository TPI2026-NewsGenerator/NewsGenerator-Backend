//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: remove-junk-feeds.js
//  Description: Takes out of the database the feeds that are no news (junk-links.js): the feeds of the edits of a wiki (the recent changes of the Greek Wikipedia gave 965 items a day),
//               their news, and the news of any other feed whose link is a page of the edits of a wiki. Read only unless --apply is given, which does, in this order: the subscriptions
//               of the readers (user_feeds) and the directory (directory_feeds) to such a feed, the news of each in batches (the stories and the threads left without news are deleted at
//               the end), the feed itself, then the news with such a link in the other feeds. The rule of the refresh (feed-service.js) keeps them from coming back
//
//  node --env-file=.env scripts/remove-junk-feeds.js            (what would go)
//  node --env-file=.env scripts/remove-junk-feeds.js --apply    (does it)
//

import process from 'node:process';
import {prisma} from '../config/db.js';
import {StoryModel} from '../models/story-model.js';
import {isWikiEditFeed, isWikiEditLink} from '../services/utils/junk-links.js';

const APPLY = process.argv.includes('--apply');
const BATCH = 2000;
// the hosts of the wikis of the family, to read only the links that may be an edit of a wiki (junk-links.js decides)
const WIKI_LINK = '^https?://([^/]+\\.)?(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikimedia|mediawiki)\\.org/';
const when = (date) => date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) : '-';

// deletes the articles by batches so that the table is not locked for minutes (the named entities and the countries of an article go with it)
const deleteArticles = async (where, ...parameters) => {
    let total = 0;
    for (;;) {
        const done = await prisma.$executeRawUnsafe(`DELETE FROM articles WHERE id IN (SELECT id FROM articles WHERE ${where} LIMIT ${BATCH})`, ...parameters);
        total += done;
        if (done < BATCH) return total;
        process.stdout.write(`\r   ${total} news deleted...`);
    }
};

try {
    const feeds = (await prisma.$queryRawUnsafe(`
        SELECT f.id, f.url, f.last_fetched_at,
            (SELECT count(*)::int FROM articles a WHERE a.id_feed = f.id) AS articles,
            (SELECT count(*)::int FROM articles a WHERE a.id_feed = f.id AND a.id_story IS NOT NULL) AS in_stories
        FROM feeds f WHERE f.url ~* '^https?://[^/]+\\.(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikimedia|mediawiki)\\.org/'`)).filter(feed => isWikiEditFeed(feed.url));
    const subscriptions = (await prisma.$queryRawUnsafe(`
        SELECT uf.id, uf.url, uf.id_user, uf.id_profile, uf.origin, uf.category, uf.created_at, p.name AS profile
        FROM user_feeds uf LEFT JOIN user_profiles p ON p.id = uf.id_profile
        WHERE uf.url ~* '^https?://[^/]+\\.(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikimedia|mediawiki)\\.org/'`)).filter(row => isWikiEditFeed(row.url));
    const directory = (await prisma.$queryRawUnsafe(`SELECT url, medium, origin FROM directory_feeds WHERE url ~* '\\.(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikiversity|wikivoyage|wikimedia|mediawiki)\\.org/'`))
        .filter(row => isWikiEditFeed(row.url));
    // the news with such a link in a feed that is not one of these (a Wikipedia page of a feed of news, the page of a user)
    const feedIds = feeds.map(feed => feed.id);
    const candidates = await prisma.$queryRawUnsafe(`SELECT id, link FROM articles WHERE link ~* $1::text AND NOT (id_feed = ANY($2::int[]))`, WIKI_LINK, feedIds);
    const otherIds = candidates.filter(row => isWikiEditLink(row.link)).map(row => row.id);

    console.log(`${APPLY ? 'REMOVING' : 'Would remove (nothing is written, give --apply to do it)'} the feeds of the edits of a wiki, ${when(new Date())} UTC\n`);
    console.log(`Feeds of the cache: ${feeds.length}`);
    for (const feed of feeds) console.log(`   #${feed.id} ${feed.url}\n      ${feed.articles} news, ${feed.in_stories} of them in stories, last read ${when(feed.last_fetched_at)}`);
    console.log(`Subscriptions of readers: ${subscriptions.length}`);
    for (const row of subscriptions) console.log(`   #${row.id} user ${row.id_user}, profile ${row.id_profile ?? '-'}${row.profile ? ` (${row.profile})` : ''}, ${row.origin}, ${row.category}, added ${when(row.created_at)}\n      ${row.url}`);
    console.log(`Feeds of the directory: ${directory.length}`);
    for (const row of directory) console.log(`   ${row.medium} (${row.origin}) ${row.url}`);
    console.log(`News with the link of an edit of a wiki in other feeds: ${otherIds.length} (of ${candidates.length} links of the wikis of the family)`);

    if (!APPLY) {
        console.log('\nNothing written. To do it:  node --env-file=.env scripts/remove-junk-feeds.js --apply');
    } else {
        const readers = await prisma.$executeRawUnsafe(`DELETE FROM user_feeds WHERE id = ANY($1::int[])`, subscriptions.map(row => row.id));
        const listed = directory.length ? await prisma.$executeRawUnsafe(`DELETE FROM directory_feeds WHERE url = ANY($1::text[])`, directory.map(row => row.url)) : 0;
        console.log(`\n${readers} subscriptions and ${listed} directory feeds deleted`);
        for (const feed of feeds) {
            const news = await deleteArticles('id_feed = $1::int', feed.id);
            await prisma.$executeRawUnsafe(`DELETE FROM feeds WHERE id = $1::int`, feed.id);
            console.log(`\r   feed #${feed.id} deleted with its ${news} news          `);
        }
        let others = 0;
        for (let from = 0; from < otherIds.length; from += BATCH) others += await prisma.$executeRawUnsafe(`DELETE FROM articles WHERE id = ANY($1::int[])`, otherIds.slice(from, from + BATCH));
        console.log(`${others} news with the link of an edit deleted in other feeds`);
        await StoryModel.deleteEmptyStories();
        console.log('Stories and threads left without news deleted. Done.');
    }
} finally {
    await prisma.$disconnect();
}
