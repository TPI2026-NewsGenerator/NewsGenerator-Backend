// The article each card of the last briefing of a user (env USER_ID) sends to read, and whether its
// passages are of it (read only)
import {BriefingService} from '../services/briefing-service.js';
import {prisma} from '../config/db.js';

const briefing = await BriefingService.latest(Number(process.env.USER_ID));
console.log(`briefing ${briefing.id} ${briefing.status}, ${briefing.items.length} cards`);
for (const item of briefing.items) {
    const lead = item.lead;
    const inList = item.articles.some(article => article.url === lead?.url);
    console.log(`${lead ? 'lead' : 'NONE'} ${lead?.source ?? '-'}${lead?.trusted ? '★' : ''} | first ${item.articles[0]?.source} | in articles ${inList} | passages ${item.summary ? 'yes' : 'no'} | sourcing ${item.sourcing}`);
    console.log(`     ${lead?.url ?? ''}`);
}
await prisma.$disconnect();
