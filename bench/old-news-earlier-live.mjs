// StoryModel.earlierNews on real stories: the earlier news of a story before a date, the closest to it by meaning first, with their distance, to read what the AI
// is given (10.11.2026). node --env-file=.env bench/old-news-earlier-live.mjs <storyId> [days before now = 1.5]
import process from 'node:process';
import {StoryModel} from '../models/story-model.js';
import {prisma} from '../config/db.js';

const [id, days = 1.5] = process.argv.slice(2).map(Number);
const before = new Date(Date.now() - days * 86400e3);
const rows = await StoryModel.earlierNews({storyIds: [id], before, perStory: 5});
const [{title}] = await prisma.$queryRawUnsafe(`SELECT left((SELECT title FROM articles WHERE id_story = $1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1), 100) AS title`, id);
console.log(`story ${id}: ${title}\n${rows.length} earlier news before ${before.toISOString()}`);
for (const row of rows) console.log(`  ${(row.at instanceof Date ? row.at.toISOString() : row.at).slice(0, 16)}  ${row.medium}  ${row.title.slice(0, 90)}`);
await prisma.$disconnect();
