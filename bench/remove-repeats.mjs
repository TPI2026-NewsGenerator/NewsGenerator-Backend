// Deletes the news saved again under another link by their feed (same feed, title and date of
// publication, see FeedModel.withoutRepeats): the first one saved stays. 30,813 rows on 2026-10-05,
// 1,402 of them not embedded yet. Prints how many it deleted.
//   node --env-file=.env bench/remove-repeats.mjs
import {prisma} from '../config/db.js';

const deleted = await prisma.$executeRawUnsafe(`
    DELETE FROM articles a
    WHERE a.published_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM articles b WHERE b.id_feed = a.id_feed AND b.published_at = a.published_at
                  AND b.title = a.title AND b.id < a.id)`);
console.log(`deleted ${deleted} repeated news`);
process.exit(0);
