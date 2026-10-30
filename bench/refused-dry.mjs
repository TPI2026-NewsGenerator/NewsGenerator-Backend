// What interestsOf answers for the profile text of a user (env USER_ID), refusals included. Writes nothing
import {prisma} from '../config/db.js';
import {interestsOf} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';
import {readerLanguage} from '../services/utils/language.js';

const row = await prisma.user_profiles.findFirst({where: {id_user: Number(process.env.USER_ID)}});
const {interests, refused} = await interestsOf({text: row.text, language: readerLanguage(row), categories: FeedService.categories()});
for (const interest of interests) console.log('-', interest.text);
console.log('refused:', JSON.stringify(refused));
await prisma.$disconnect();
process.exit(0);
