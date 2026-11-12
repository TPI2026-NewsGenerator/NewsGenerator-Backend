//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: find-kenya-card.mjs
//  Description: The card of the FKF normalisation committee (Kenya) whose "story so far" lists the one of the NFF (Nigeria): the stories of
//               its thread, their countries by the items their news name, to see what tells them apart. Reads, writes nothing
//
//  node bench/timeline-so-far/find-kenya-card.mjs
//

import 'dotenv/config';
import {prisma} from '../../config/db.js';

const rows = await prisma.$queryRawUnsafe(`
    SELECT id, created_at, items, analysis FROM briefings
    WHERE status = 'ready' AND created_at > now() - interval '5 days'
    ORDER BY id DESC`);
let shown = 0;
for (const row of rows) {
    for (const item of row.items ?? []) {
        const timeline = row.analysis?.cards?.[item.storyId]?.timeline ?? [];
        if (!/FKF|Kenya/i.test(`${item.title} ${item.titleTranslation ?? ''}`) || timeline.length === 0) continue;
        if (shown++ >= 3) continue;
        console.log(`briefing ${row.id} card ${item.storyId} "${item.title}" countries ${JSON.stringify(item.countries)}`);
        for (const line of timeline) console.log(`   ${line.date} ${line.title.slice(0, 90)} (${line.medium})`);
    }
}
console.log(`${shown} cards`);
await prisma.$disconnect();
