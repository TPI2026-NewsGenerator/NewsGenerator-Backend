// The cards of the stored briefings of a reader read again by readStories, live (pages fetched, AI
// called): the ones shown without passages must now be said unreadable, the others read. Nothing is
// written to the briefings (resolved addresses of Google News are saved as the briefing does).
//   node --env-file=.env bench/read-stories-replay.mjs [userId=482] [readable cards to compare=5]
import {prisma} from '../config/db.js';
import {FeedModel} from '../models/feed-model.js';
import {readStories} from '../services/briefing-service.js';
import {newUsage} from '../services/utils/ollama.js';
import {readerLanguage} from '../services/utils/language.js';

const userId = Number(process.argv[2] ?? 482);
const compared = Number(process.argv[3] ?? 5);
const items = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT ON ((i->>'storyId')::int) (i->>'storyId')::int AS story, i->>'title' AS title, i->>'summary' IS NULL AS without
    FROM briefings b, jsonb_array_elements(b.items) i
    WHERE b.id_user = $1 AND b.status = 'ready' AND b.created_at >= now() - interval '7 days'`, userId);
const without = items.filter(item => item.without);
const withPassages = items.filter(item => !item.without).slice(0, compared);

const [profile] = await prisma.$queryRawUnsafe('SELECT languages FROM user_profiles WHERE id_user = $1', userId);
const language = readerLanguage(profile);
const trusted = new Set(await FeedModel.trustedMedia(userId));
const storyOf = async (storyId) => {
    const members = await prisma.$queryRawUnsafe(`
        SELECT a.id, a.link, a.title, a.description, a.lang, a.resolved_link, f.url AS feed_url, COALESCE(a.published_at, a.created_at) AS at
        FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE a.id_story = $1 ORDER BY a.id`, storyId);
    return members.length ? {storyId, best: members[0], members} : null;
};

const usage = newUsage();
for (const [name, list] of [['shown without passages', without], ['shown with passages', withPassages]]) {
    const stories = (await Promise.all(list.map(item => storyOf(item.story)))).filter(Boolean);
    const read = await readStories(stories, {trusted, language, usage: {summarizing: usage, contesting: usage}});
    console.log(`\n== ${name}: ${stories.length} stories (${list.length - stories.length} gone from the database)`);
    for (const result of read) {
        const state = result.unreadable ? 'UNREADABLE, replaced' : result.summary ? 'read' : 'read, AI failed';
        console.log(`  ${state.padEnd(20)} [${result.story.members.length} news] ${result.story.best.title}`);
    }
}
console.log(`\ntokens ${JSON.stringify(usage)}`);
process.exit(0);
