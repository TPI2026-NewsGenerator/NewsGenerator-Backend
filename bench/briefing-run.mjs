// Writes a briefing for a user (env USER_ID) with the code of this laptop, waits for it, and prints its
// cards: language of the lead, title (translated), joined stories, media. HOURS: of news (48 by default)
import {BriefingService} from '../services/briefing-service.js';
import {prisma} from '../config/db.js';

const userId = Number(process.env.USER_ID);
const started = await BriefingService.start(userId, Number(process.env.HOURS ?? 48));
console.log(`briefing ${started.id} of ${started.hours} hours started`);
let briefing = started;
while (briefing.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 3000));
    briefing = await BriefingService.latest(userId);
}
console.log(`briefing ${briefing.id}: ${briefing.status} ${briefing.error ?? ''} in ${Math.round((Date.now() - new Date(started.createdAt ?? Date.now())) / 1000)} s`);
for (const item of briefing.items ?? []) {
    console.log(`${item.articles?.some(article => article.trusted) ? "T" : " "} ${item.language ?? "?"} +${item.mergedStoryIds.length} ${item.corroboration?.mediaNames?.length ?? 0} media | ${item.title.slice(0, 80)}${item.titleTranslation ? `\n      -> ${item.titleTranslation.slice(0, 80)}` : ''}`);
}
await prisma.$disconnect();
