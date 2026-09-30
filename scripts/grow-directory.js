//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: grow-directory.js
//  Description: Fills the directory of the project the first time (db/add_directory.sql): the media
//               Google News names that no feed reads, and the sections of the media already read.
//               The server then looks at a few more after each run of the ingestion
//
//  node scripts/grow-directory.js [named] [sections] [concurrency]     (all of them by default)
//

import 'dotenv/config';
import process from 'node:process';
import {DirectoryService} from '../services/directory-service.js';
import {guardFetch} from '../services/utils/public-url.js';

guardFetch();

const [named = 1000, sections = 1000, concurrency = 6] = process.argv.slice(2).map(Number);
const started = Date.now();
const tried = await DirectoryService.grow({named, sections, concurrency});

for (const origin of ['named', 'section']) {
    const media = tried.filter(medium => medium.origin === origin);
    const kept = media.flatMap(medium => medium.kept);
    console.log(`\n${origin}: ${media.length} media looked at, ${kept.length} feeds kept`);
    for (const feed of kept) console.log(`  ${feed.language ?? '??'}/${(feed.category ?? '-').padEnd(10)} ${feed.url}`);
    const reasons = new Map();
    for (const medium of media.filter(medium => medium.kept.length === 0)) {
        const reason = medium.reason?.replace(/\d+ feeds/, 'N feeds') ?? 'none';
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    console.log(`  none kept: ${[...reasons.entries()].map(([reason, count]) => `${reason} ${count}`).join(', ')}`);
}
console.log(`\n${Math.round((Date.now() - started) / 1000)} s`);
process.exit(0);
