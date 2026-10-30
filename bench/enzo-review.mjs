// Replays the last step of a briefing (reviewCards) on the cards of the last ready briefing of a user
// (env USER_ID) with its profile text of now: which cards it would leave out. Writes nothing
import {prisma} from '../config/db.js';
import {reviewCards} from '../services/utils/profile-ai.js';

const userId = Number(process.env.USER_ID);
const RUNS = Number(process.env.RUNS ?? 3);
const profile = await prisma.user_profiles.findFirst({where: {id_user: userId}});
const briefing = await prisma.briefings.findFirst({where: {id_user: userId, status: 'ready'}, orderBy: {id: 'desc'}});
const cards = (briefing?.items ?? []).map(item => ({id: String(item.storyId), title: item.title, summary: item.summary}));
const titleOf = new Map(cards.map(card => [card.id, card.title]));
for (let run = 1; run <= RUNS; run++) {
    const leftOut = await reviewCards(profile.text, cards);
    console.log(`run ${run}: ${leftOut.size} left out`);
    for (const [id, why] of leftOut) console.log(`  - ${titleOf.get(id)}  (${why})`);
}
await prisma.$disconnect();
