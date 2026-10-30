// The profile text of a user (env USER_ID) and the passages of the cards of their last briefing whose
// title holds env WORDS (read only)
import {BriefingService} from '../services/briefing-service.js';
import {ProfileModel} from '../models/profile-model.js';
import {prisma} from '../config/db.js';

const userId = Number(process.env.USER_ID);
const profile = await ProfileModel.get(userId);
console.log(`profile: ${profile?.text}\nrefused: ${JSON.stringify(profile?.refused)}`);
const briefing = await BriefingService.latest(userId);
for (const item of briefing.items.filter(item => item.title.includes(process.env.WORDS))) {
    console.log(`\n${item.title}\nwhy: ${item.why}\n${item.summary}`);
}
await prisma.$disconnect();
