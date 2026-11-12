//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: likeness.mjs
//  Description: The lines of "the story so far" of the cards of the last days, each with how much its story looks like the card's (cosine of
//               their centroids), the lowest first: do the lines of another affair (the NFF of Nigeria on a card of the FKF of Kenya) stand
//               apart? Reads, writes nothing
//
//  node bench/timeline-so-far/likeness.mjs [days = 5] [lowest = 40]
//

import 'dotenv/config';
import {prisma} from '../../config/db.js';

const days = Number(process.argv[2] ?? 5);
const lowest = Number(process.argv[3] ?? 40);
const briefings = await prisma.$queryRawUnsafe(
    `SELECT id, items FROM briefings WHERE status = 'ready' AND created_at > now() - ($1 || ' days')::interval ORDER BY id`, String(days));
const stories = [...new Set(briefings.flatMap(row => (row.items ?? []).map(item => item.storyId)))];
const rows = await prisma.$queryRawUnsafe(`
    SELECT s.id AS card, o.id, first.title, (1 - (o.centroid <=> s.centroid))::float AS likeness
    FROM stories s
    JOIN stories o ON o.id_thread = s.id_thread AND o.id <> s.id AND o.created_at < s.created_at
    CROSS JOIN LATERAL (SELECT a.title FROM articles a WHERE a.id_story = o.id ORDER BY COALESCE(a.published_at, a.created_at) LIMIT 1) AS first
    WHERE s.id = ANY($1::int[]) AND s.id_thread IS NOT NULL AND o.centroid IS NOT NULL AND s.centroid IS NOT NULL`, stories);
const titles = new Map(briefings.flatMap(row => (row.items ?? []).map(item => [item.storyId, item.title])));
rows.sort((a, b) => a.likeness - b.likeness);
console.log(`${rows.length} lines; likeness of the card's centroid to the line's`);
for (const q of [0, 0.1, 0.25, 0.5, 0.75, 1]) console.log(`  quantile ${q}: ${rows[Math.min(rows.length - 1, Math.floor(q * rows.length))].likeness.toFixed(3)}`);
for (const row of rows.slice(0, lowest)) console.log(`${row.likeness.toFixed(3)} card "${String(titles.get(row.card)).slice(0, 55)}" | line "${row.title.slice(0, 70)}"`);
await prisma.$disconnect();
