// The briefing of a reader replayed up to the joined cards (nothing saved), once with the languages
// they ticked, once with every language of the news their feeds bring, to see what reading every
// language changes: the languages of the ranked stories, of the candidates and of the cards.
//   node --env-file=.env bench/briefing-languages.mjs <userId>
import process from 'node:process';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, checkStories, mergeStories, selectStories} from '../services/utils/profile-ai.js';
import {credibleStory, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const userId = Number(process.argv[2]);
const profile = await ProfileModel.get(userId);
const interests = await ProfileModel.interests(userId);
const feedback = await FeedbackService.of(userId);
const refused = new Set(feedback.refused);
const since = new Date(Date.now() - 48 * 3600e3);
const media = new Set(await FeedModel.feedMedia());
const allBase = Object.values(rss).flatMap(c => Object.values(c).flat());
const own = await FeedModel.userFeedUrls(userId);
const searches = await searchesOfUser(userId);
const count = (xs) => Object.entries(xs.reduce((m, x) => ({...m, [x]: (m[x] ?? 0) + 1}), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
const mediumOfArticle = (a) => mediumOf(hostOf(a.source_url ?? a.link) ?? '');
const brief = (a, c) => ({title: a.title, description: (a.description ?? '').replace(/<[^>]*>/g, ' ').slice(0, c)});

const replay = async (name, languages, base) => {
    const feedUrls = [...new Set([...base, ...own, ...searches])].filter(u => !refused.has(u));
    let t = Date.now();
    const ranked = await StoryModel.rank({userId, feedUrls, since, languages, sparseWeight: 0.5, limit: 150});
    const rankMs = Date.now() - t;
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const langOf = new Map((await prisma.$queryRawUnsafe(`SELECT id, lang FROM articles WHERE id = ANY($1::int[])`, ranked.map(r => r.id_article))).map(r => [r.id, r.lang]));
    const stories = ranked.map(r => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, lang: langOf.get(r.id_article), best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news, score: Number(r.score)};
    });
    const credible = stories.filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members));
    const candidates = pickCandidates(credible, {fromFeeds: 40, extra: 10, perMedium: 2});
    const chosen = await selectStories(profile.text, candidates.map(s => ({
        id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
        others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3),
    })), null, feedback.examples, interests.map(i => i.text));
    const byId = new Map(candidates.map(s => [String(s.storyId), s]));
    const selected = balanceSelection(chosen, id => byId.get(id)?.interestId, interests);
    const picked = selected.map(item => ({...byId.get(item.id), why: item.why}));
    const merges = await mergeStories(picked.map(s => ({id: String(s.storyId), lead: brief(s.best, 200)})));
    const cards = picked.filter(s => !merges.has(String(s.storyId)));
    console.log(`\n=== ${name}: ${languages.length} languages, ${feedUrls.length} feeds, ranked ${ranked.length} in ${rankMs} ms (scores ${stories[0]?.score.toFixed(3)} .. ${stories.at(-1)?.score.toFixed(3)})`);
    console.log(`ranked languages: ${count(stories.map(s => s.lang))}`);
    console.log(`candidates ${candidates.length}: ${count(candidates.map(s => s.lang))}`);
    console.log(`chosen ${chosen.length}, balanced ${selected.length}, joined ${merges.size} -> cards ${cards.length}: ${count(cards.map(s => s.lang))}`);
    for (const s of cards) console.log(`  [${s.lang}] ${s.best.title.slice(0, 95)} (${new Set(s.members.map(mediumOfArticle)).size} media) — ${s.why?.slice(0, 80)}`);
    return cards;
};

const ticked = [...new Set(profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()))];
const all = (await prisma.$queryRawUnsafe(`SELECT DISTINCT lang FROM articles WHERE lang IS NOT NULL AND created_at > now() - interval '48 hours'`)).map(r => r.lang);
const a = await replay('A ticked languages', profile.languages, ticked);
const b = await replay('B every language, every shared feed', all, allBase);
const inA = new Set(a.map(s => s.storyId));
console.log(`\ncards of B also in A: ${b.filter(s => inA.has(s.storyId)).length} of ${b.length}`);
process.exit(0);
