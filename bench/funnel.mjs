// How many news each step keeps, for the explanatory diagram: the background work of the last 24 h,
// then the briefing of one reader replayed up to the AI check (nothing saved), and one sentence search.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/funnel.mjs <userId> <language> "<sentence>"
import process from 'node:process';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, checkStories, mergeStories, selectStories} from '../services/utils/profile-ai.js';
import {credibleStory, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const [userId, language, sentence] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const n = (rows) => Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));

// 1. the background work
console.log('== store ==', n(await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM feeds) AS feeds,
           (SELECT count(DISTINCT id_feed) FROM articles WHERE created_at > now() - interval '24 hours') AS feeds_with_news_24h,
           (SELECT count(*) FROM articles) AS articles_30d,
           (SELECT count(*) FROM stories) AS stories,
           (SELECT count(*) FROM threads) AS threads,
           (SELECT count(*) FROM directory_feeds) AS directory_feeds,
           (SELECT count(*) FROM user_feeds) AS user_feeds`)));
console.log('== 24 h ==', n(await prisma.$queryRawUnsafe(`
    SELECT count(*) AS inserted,
           count(*) FILTER (WHERE embedded_at IS NOT NULL) AS embedded,
           count(*) FILTER (WHERE id_story IS NOT NULL) AS in_story,
           count(*) FILTER (WHERE COALESCE(published_at, created_at) < now() - interval '48 hours') AS older_than_window,
           count(DISTINCT lang) AS languages,
           count(DISTINCT medium) AS media,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM embedded_at - created_at)) AS median_s_to_vector
    FROM articles WHERE created_at > now() - interval '24 hours'`)));
console.log('== stories of the 24 h news ==', n(await prisma.$queryRawUnsafe(`
    WITH s AS (SELECT a.id_story, count(*) AS news, count(DISTINCT a.medium) AS media FROM articles a
               WHERE a.created_at > now() - interval '24 hours' AND a.id_story IS NOT NULL GROUP BY 1)
    SELECT count(*) AS stories, count(*) FILTER (WHERE media >= 2) AS multi_media,
           count(*) FILTER (WHERE news = 1) AS alone,
           (SELECT count(DISTINCT st.id_thread) FROM stories st JOIN s ON s.id_story = st.id) AS threads
    FROM s`)));
console.log('== top languages 24 h ==', (await prisma.$queryRawUnsafe(`
    SELECT lang, count(*)::int AS n FROM articles WHERE created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`))
    .map(r => `${r.lang} ${r.n}`).join(', '));

// 2. the reader
const profile = await ProfileModel.get(userId);
const interests = await ProfileModel.interests(userId);
const own = await prisma.$queryRawUnsafe(`SELECT origin, count(*)::int AS n FROM user_feeds WHERE id_user = $1 GROUP BY 1`, userId);
const base = [...new Set(profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()))];
const searches = await searchesOfUser(userId);
console.log(`\n== reader ${userId} == languages ${profile.languages.length} (${profile.languages.slice(0, 6).join(',')}), topics ${profile.topics.length}, text ${profile.text.length} chars, interests ${interests.length}`);
console.log('own feeds', own.map(r => `${r.origin} ${r.n}`).join(', '), `| base feeds of the languages ${base.length} | Google searches ${searches.length}`);
interests.forEach(i => console.log(`  interest ${i.id}: ${i.text.slice(0, 90)}`));

const feedback = await FeedbackService.of(userId);
const refused = new Set(feedback.refused);
const feedUrls = [...new Set([...base, ...await FeedModel.userFeedUrls(userId), ...searches])].filter(u => !refused.has(u));
const since = new Date(Date.now() - 48 * 3600e3);
console.log('== 48 h window of the reader ==', n(await prisma.$queryRawUnsafe(`
    SELECT count(DISTINCT a.link) AS news,
           count(DISTINCT a.link) FILTER (WHERE a.lang = ANY($3)) AS in_languages,
           count(DISTINCT a.link) FILTER (WHERE a.lang = ANY($3) AND a.embedded_at IS NOT NULL AND a.id_story IS NOT NULL) AS ranked_news,
           count(DISTINCT a.id_story) FILTER (WHERE a.lang = ANY($3)) AS stories
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE f.url = ANY($1) AND COALESCE(a.published_at, a.created_at) >= $2`, feedUrls, since, profile.languages)), `feeds ${feedUrls.length}, refused ${refused.size}`);

let t = Date.now();
const ranked = await StoryModel.rank({userId, feedUrls, since, languages: profile.languages, sparseWeight: 0.5, limit: 150});
console.log(`ranked ${ranked.length} in ${Date.now() - t} ms, scores ${Number(ranked[0]?.score).toFixed(3)} .. ${Number(ranked.at(-1)?.score).toFixed(3)}`);
const members = new Map(ranked.map(r => [r.id_story, []]));
for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
const media = new Set(await FeedModel.feedMedia());
const stories = ranked.map(r => {
    const news = members.get(r.id_story);
    return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news, score: Number(r.score)};
});
const credible = stories.filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members));
const candidates = pickCandidates(credible.sort((a, b) => b.score - a.score), {fromFeeds: 40, extra: 10, perMedium: 2});
console.log(`credible ${credible.length}, candidates ${candidates.length} (articles in them ${candidates.reduce((s, c) => s + c.members.length, 0)})`);

t = Date.now();
const chosen = await selectStories(profile.text, candidates.map(s => ({
    id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
    others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3),
})), null, feedback.examples, interests.map(i => i.text));
const byId = new Map(candidates.map(s => [String(s.storyId), s]));
const selected = balanceSelection(chosen, id => byId.get(id)?.interestId, interests);
console.log(`AI chose ${chosen.length}, balanced ${selected.length} in ${Date.now() - t} ms`);

const mediumOfArticle = (a) => mediumOf(hostOf(a.source_url ?? a.link) ?? '');
const toCheck = (s) => {
    const others = s.members.filter(a => a !== s.best).sort((a, b) => b.at - a.at);
    const seen = new Set([mediumOfArticle(s.best)]);
    const first = [], then = [];
    for (const a of others) { (seen.has(mediumOfArticle(a)) ? then : first).push(a); seen.add(mediumOfArticle(a)); }
    return [...first, ...then].slice(0, 12);
};
const brief = (a, c) => ({title: a.title, description: (a.description ?? '').replace(/<[^>]*>/g, ' ').slice(0, c)});
const picked = selected.map(item => byId.get(item.id));
const asked = picked.map(s => ({s, others: toCheck(s)})).filter(x => x.others.length > 0);
t = Date.now();
const [checked, merges] = await Promise.all([
    checkStories(asked.map(({s, others}) => ({id: String(s.storyId), lead: brief(s.best, 200), others: others.map(a => brief(a, 150))}))),
    mergeStories(picked.map(s => ({id: String(s.storyId), lead: brief(s.best, 200)}))),
]);
const before = picked.reduce((sum, s) => sum + s.members.length, 0);
const checkedOthers = asked.reduce((sum, x) => sum + x.others.length, 0);
const keptOthers = asked.reduce((sum, x) => sum + (checked.get(String(x.s.storyId))?.size ?? x.others.length), 0);
const mediaBefore = picked.map(s => new Set(s.members.map(mediumOfArticle)).size);
console.log(`check+merge in ${Date.now() - t} ms: articles of the chosen stories ${before}, checked ${checkedOthers}, kept ${keptOthers}; cards joined ${merges.size} -> ${picked.length - merges.size} cards; media per story ${mediaBefore.join(',')}`);

// the real briefings of this reader
const briefings = await prisma.$queryRawUnsafe(`
    SELECT id, created_at, extract(epoch FROM finished_at - created_at)::int AS seconds, jsonb_array_length(items) AS cards,
           (SELECT count(*) FROM jsonb_array_elements(items) i WHERE i->>'summary' IS NOT NULL)::int AS with_passages,
           (SELECT round(avg((i->'corroboration'->>'media')::numeric), 1) FROM jsonb_array_elements(items) i) AS media,
           (SELECT round(avg(jsonb_array_length(i->'articles')), 1) FROM jsonb_array_elements(items) i) AS articles
    FROM briefings WHERE id_user = $1 AND status = 'ready' ORDER BY id DESC LIMIT 5`, userId);
briefings.forEach(b => console.log(`  briefing ${b.id} ${b.created_at.toISOString()} ${b.seconds} s: ${b.cards} cards, ${b.with_passages} with passages, media ${b.media}, articles ${b.articles}`));

// 3. one sentence search
if (sentence) {
    const seen = {};
    const closest = FeedModel.closestArticles;
    FeedModel.closestArticles = async (args) => {
        const rows = await closest(args);
        seen.candidates = rows.length;
        seen.languages = new Set(rows.map(r => r.lang)).size;
        seen.lines = new Set(rows.map(r => r.id_story != null ? `s${r.id_story}` : `t${r.title}`)).size;
        return rows;
    };
    const pairs = FeedModel.closeCardPairs;
    FeedModel.closeCardPairs = async (...args) => { const rows = await pairs(...args); seen.closePairs = rows.length; return rows; };
    t = Date.now();
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), userId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const answers = found.news.filter(c => c.match === 'answer').length;
    console.log(`\n== search "${sentence}" (${language}, 7 days) in ${Date.now() - t} ms ==`, seen,
        `cards ${found.news.length} (answers ${answers}, related ${found.news.length - answers}), joined sources ${found.news.reduce((s, c) => s + c.sources.length, 0)}, with facts ${found.news.filter(c => c.facts?.length).length}`);
}
process.exit(0);
