// The profile of a user (env USER_ID): its text, its interests, and the cards of its last briefing
// whose title or topic speaks of women's football
import {prisma} from '../config/db.js';

const userId = Number(process.env.USER_ID);
const profile = await prisma.user_profiles.findFirst({where: {id_user: userId}});
console.log('TEXT:', profile?.text);
const interests = await prisma.profile_interests.findMany({where: {id_user: userId}, select: {text: true, weight: true}});
for (const interest of interests) console.log('-', interest.weight, interest.text);
const briefing = await prisma.briefings.findFirst({where: {id_user: userId, status: 'ready'}, orderBy: {id: 'desc'}});
console.log('briefing', briefing?.id, briefing?.created_at);
for (const item of briefing?.items ?? []) {
    console.log(`  [${item.language}] ${item.title}${item.titleTranslation ? `  =>  ${item.titleTranslation}` : ''}`);
}
await prisma.$disconnect();
