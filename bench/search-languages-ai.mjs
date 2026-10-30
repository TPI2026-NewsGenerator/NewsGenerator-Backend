// The languages the AI chooses to search the media of each interest in, once the reader has one
// language (the display one) and the briefing reads every language. On the test profiles (their first
// language as the display one) and on profiles written for it whose subjects belong to one country.
//   node --env-file=.env bench/search-languages-ai.mjs [runs]
import process from 'node:process';
import {prisma} from '../config/db.js';
import {interestsOf} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';

const runs = Number(process.argv[2]) || 1;
const categories = FeedService.categories();
const rows = await prisma.$queryRawUnsafe(`
    SELECT p.id_user, p.text, p.topics, p.languages,
           (SELECT array_agg(DISTINCT split_part(s, ':', 1)) FROM profile_interests i, unnest(i.searches) s WHERE i.id_user = p.id_user) AS before
    FROM user_profiles p WHERE p.id_user = ANY($1::int[]) ORDER BY p.id_user`, (process.env.USERS ?? "4,129,154,290,311,384,389,482").split(",").map(Number));
const written = process.env.USERS && !process.env.WRITTEN ? [] : [
    {id_user: 'serbe', text: "Le football serbe : l'Étoile rouge de Belgrade, le Partizan et l'équipe nationale de Serbie.", topics: [], languages: ['fr']},
    {id_user: 'suisse', text: 'Les votations fédérales suisses et les décisions du Conseil fédéral.', topics: [], languages: ['fr']},
    {id_user: 'japon', text: 'Japanese politics, the Diet and the Bank of Japan decisions.', topics: [], languages: ['en']},
    {id_user: 'ia', text: 'Les nouveaux modèles d\'intelligence artificielle et les outils pour programmer.', topics: [], languages: ['fr']},
    {id_user: 'hongrie', text: 'Ungarische Innenpolitik und Viktor Orbán, und der Fußballclub Ferencváros.', topics: [], languages: ['de']},
];
for (const p of [...rows, ...written]) {
    console.log(`\n== ${p.id_user} display ${p.languages[0]}${p.before ? `, searched before: ${p.before.join(',')}` : ''} — ${p.text.slice(0, 90).replace(/\s+/g, ' ')}`);
    for (let run = 0; run < runs; run++) {
        const interests = await interestsOf({text: p.text, topics: p.topics, language: p.languages[0], categories});
        for (const i of interests) {
            const langs = [...new Set(i.searches.map(s => s.split(':')[0]))];
            console.log(`  [${langs.join(',')}] ${i.text.slice(0, 70)} | ${i.searches.filter(s => !/^(en|fr|de):/.test(s)).join(' ; ').slice(0, 90)}`);
        }
    }
}
process.exit(0);
