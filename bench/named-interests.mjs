// Read only: does the briefing miss news of an interest that names someone ("Cristiano Ronaldo", "the
// IFAB")? For each interest of the profiles used lately, the names it holds that the tagger knows (a
// person or an organization, written with a capital, named by MIN_SEEN news at least), the stories of
// the window whose news name one (article_mentions), and where the ranking of the briefing puts them:
// in the RANKED kept (150, shared out by interest), in the first CANDIDATES of their interest, or out.
// The ones out are listed, to judge by hand whether the briefing should have seen them
//   node --env-file=.env bench/named-interests.mjs [hours] [profileIds]  -> bench/data/named-interests.txt
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {StoryModel} from '../models/story-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {feedsOf} from '../services/briefing-service.js';
import {shareOut} from '../services/utils/profile-ai.js';
import {mentionKey} from '../services/utils/mentions.js';

const hours = Number(process.argv[2] ?? 48);
const profileIds = (process.argv[3] ?? '7,137,242,8').split(',').map(Number);
const MIN_SEEN = 20;
const RANKED = 150, POOL = 600, CANDIDATES = 40;
const since = new Date(Date.now() - hours * 3600e3);
const lines = [`window ${hours} h, names of an interest: person or organization named by ${MIN_SEEN} news or more`, ''];

// the groups of 1 to 4 words of a text starting with a capital or written in capitals
const groupsOf = (text) => {
    const words = text.split(/[^\p{L}\p{N}'’&-]+/u).filter(Boolean);
    const groups = new Set();
    for (let i = 0; i < words.length; i++) {
        if (!/^\p{Lu}/u.test(words[i])) continue;
        for (let n = 1; n <= 4 && i + n <= words.length; n++) groups.add(words.slice(i, i + n).join(' '));
    }
    return [...groups];
};

for (const profileId of profileIds) {
    const interests = await ProfileModel.briefingInterests(profileId);
    const feedUrls = await feedsOf(profileId);
    const pool = await StoryModel.rank({profileId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: POOL});
    const kept = shareOut(pool, RANKED, row => row.id_interest, interests);
    const rankOf = new Map(kept.map((row, i) => [row.id_story, i]));
    const poolOf = new Map(pool.map((row, i) => [row.id_story, i]));
    const firstOf = new Set(shareOut(kept, CANDIDATES, row => row.id_interest, interests).map(row => row.id_story));
    lines.push(`=== profile ${profileId}: ${interests.length} interests, ${feedUrls.length} feeds, pool ${pool.length}, kept ${kept.length}`);

    for (const interest of interests) {
        const keys = [...new Set(groupsOf(interest.text).map(mentionKey).filter(key => key.length >= 3))];
        const names = await prisma.$queryRawUnsafe(`
            SELECT id, name, kind, qid, seen FROM mentions
            WHERE key = ANY($1::text[]) AND kind IN ('person', 'organization') AND seen >= $2 ORDER BY seen DESC`, keys, MIN_SEEN);
        if (names.length === 0) continue;
        const stories = await prisma.$queryRawUnsafe(`
            WITH named AS (
                SELECT id FROM mentions WHERE id = ANY($1::int[])
                   OR qid = ANY(SELECT qid FROM mentions WHERE id = ANY($1::int[]) AND qid IS NOT NULL)
            )
            SELECT a.id_story, count(DISTINCT a.id)::int AS news, (array_agg(a.title ORDER BY a.created_at DESC))[1] AS title,
                   bool_or(a.title ILIKE ANY($4::text[])) AS in_title
            FROM named n JOIN article_mentions am ON am.id_mention = n.id JOIN articles a ON a.id = am.id_article
            JOIN feeds f ON f.id = a.id_feed
            WHERE a.id_story IS NOT NULL AND f.url = ANY($2::text[]) AND COALESCE(a.published_at, a.created_at) >= $3::timestamptz
            GROUP BY a.id_story ORDER BY count(DISTINCT a.id) DESC`,
            names.map(name => name.id), feedUrls, since, names.map(name => `%${name.name}%`));
        const at = (story) => rankOf.has(story.id_story) ? (firstOf.has(story.id_story) ? 'candidate' : 'kept') : poolOf.has(story.id_story) ? 'pool' : 'out';
        const count = (place, list = stories) => list.filter(story => at(story) === place).length;
        const titled = stories.filter(story => story.in_title);
        lines.push(`interest ${interest.id} "${interest.text.slice(0, 70)}"`);
        lines.push(`  names: ${names.slice(0, 8).map(name => `${name.name} (${name.kind[0]}, ${name.seen})`).join(', ')}`);
        lines.push(`  stories naming them: ${stories.length}; first ${CANDIDATES} ${count('candidate')}, kept ${RANKED} ${count('kept')}, pool ${POOL} ${count('pool')}, out ${count('out')}`);
        lines.push(`  of them naming one in the title: ${titled.length}; first ${count('candidate', titled)}, kept ${count('kept', titled)}, pool ${count('pool', titled)}, out ${count('out', titled)}`);
        const shownPlaces = process.env.ALL ? ['candidate', 'kept', 'pool', 'out'] : ['pool', 'out'];
        for (const story of titled.filter(story => shownPlaces.includes(at(story))).slice(0, Number(process.env.ROWS ?? 25))) {
            lines.push(`    ${at(story).padEnd(9)} ${String(story.news).padStart(3)} news  #${story.id_story} ${story.title?.slice(0, 120)}`);
        }
    }
    lines.push('');
}
fs.writeFileSync(new URL('./data/named-interests.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await prisma.$disconnect();
process.exit(0);
