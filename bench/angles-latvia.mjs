// The other angles of the Latvian card of profile 7 (story 647742, briefing 87 of 12.10.2026) as the
// briefing finds them now, the stories naming its rare names included, nothing saved:
//   node --env-file=.env bench/angles-latvia.mjs [storyId] [profileId]
import {anglesOf, feedsOf} from '../services/briefing-service.js';
import {StoryModel} from '../models/story-model.js';
import {MentionModel} from '../models/mention-model.js';
import {rareNames} from '../services/utils/mentions.js';
import {storiesOfSameNames} from '../services/utils/affair-names.js';
import {ProfileModel} from '../models/profile-model.js';
import {readerLanguage} from '../services/utils/language.js';
import {newUsage} from '../services/utils/ollama.js';
import {prisma} from '../config/db.js';
const storyId = Number(process.argv[2] ?? 647742), profileId = Number(process.argv[3] ?? 7);
const feedUrls = await feedsOf(profileId);
const language = readerLanguage(await ProfileModel.get(profileId));
const members = await StoryModel.storyArticles({storyIds: [storyId], feedUrls, since: new Date(Date.now() - 30 * 864e5)});
const story = {storyId, members, best: members[0]};
console.log(`card: ${members[0].title} (${members.length} news, ${members.filter(m => m.id).length} with id)`);
// Only the news on Latvia are tagged yet: how many news name each name is estimated from their texts
// of the 30 days, as it will be once all are tagged (the UEFA is named by thousands, not 71)
if (process.env.ESTIMATE !== 'off') {
    const read = MentionModel.namesOfArticles;
    MentionModel.namesOfArticles = async (ids, upTo) => Promise.all((await read(ids, upTo)).map(async (row) => {
        const [{n}] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM (SELECT 1 FROM articles WHERE created_at > now() - interval '30 days'
            AND search_text ILIKE $1 LIMIT $2) t`, `%${row.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()}%`, upTo);
        return {...row, news: Math.max(row.news, n)};
    }));
}
const rows = await MentionModel.namesOfArticles(members.map(m => m.id), 401);
console.log('names of the card:', rows.map(r => `${r.name} [${r.kind}] ${r.inCard}/${r.news}${r.qid ? ' ' + r.qid : ''}`).join(' | '));
console.log('rare:', rareNames(rows, {rare: 400, max: 4}).map(r => r.name).join(', '));
const named = await storiesOfSameNames([story], {feedUrls, since: new Date(Date.now() - 30 * 864e5), excluded: [], perStory: 13});
const namedIds = (named.get(storyId) ?? []).map(row => row.id_story);
const titles = namedIds.length ? await StoryModel.storyArticles({storyIds: namedIds, feedUrls, since: new Date(Date.now() - 30 * 864e5)}) : [];
for (const row of named.get(storyId) ?? []) {
    const news = titles.find(a => a.id === row.id_article) ?? titles.find(a => a.id_story === row.id_story);
    console.log(`  named ${row.shared} ${row.likeness?.toFixed(2)} ${news?.at?.toISOString().slice(0, 10)} ${news?.title}`);
}
const usage = newUsage();
const t = Date.now();
const angles = await anglesOf([story], [members[0].title], {language, feedUrls, hours: 48, trusted: new Set(), usage});
console.log(`\n${Date.now() - t} ms, ${JSON.stringify(usage)}`);
for (const angle of angles.get(storyId) ?? []) console.log(`ANGLE ${angle.publishedAt?.slice(0, 10)} ${angle.title} | ${angle.titleTranslation ?? ''}`);
await prisma.$disconnect();
process.exit(0);
