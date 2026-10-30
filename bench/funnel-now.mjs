// How many news each step keeps, for the diagram "Parcours NewsGenerator", with the code of 17.10.2026
// (profiles, every language read, the interests sharing the cards, the stories sent before left out):
// the background work of the last 24 h, the briefing of one profile replayed up to the check and merge
// of the AI (nothing saved; DiscoveryService.prune, which removes sources, and the versions in other
// languages are left out), over 48 h and 7 days, then one sentence search.
//   SEARCH_GOOGLE_NEWS=off node --env-file=.env bench/funnel-now.mjs <profileId> ["<sentence>"]
import process from 'node:process';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {BriefingModel} from '../models/briefing-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {NewsService} from '../services/news-service.js';
import {FeedService} from '../services/feed-service.js';
import {feedsOf} from '../services/briefing-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, checkStories, mergeStories, selectStories, shareOut} from '../services/utils/profile-ai.js';
import {credibleStory, googleAvailable, isGoogleNewsUrl, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {evolvedStories, REPEAT_HOURS, shownStories, withoutRepeats} from '../services/utils/repeats.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';
import {readerLanguage} from '../services/utils/language.js';

const [profileId, sentence] = [Number(process.argv[2]), process.argv[3]];
const n = (rows) => Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));

// 1. the background work
console.log('== store ==', n(await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM feeds) AS feeds,
           (SELECT count(DISTINCT id_feed) FROM articles WHERE created_at > now() - interval '24 hours') AS feeds_with_news_24h,
           (SELECT count(*) FROM articles) AS articles_30d,
           (SELECT count(*) FROM stories) AS stories,
           (SELECT count(*) FROM threads) AS threads,
           (SELECT count(*) FROM directory_feeds) AS directory_feeds,
           (SELECT count(DISTINCT url) FROM user_feeds) AS reader_feeds,
           (SELECT count(*) FROM user_profiles) AS profiles`)));
console.log('== 24 h ==', n(await prisma.$queryRawUnsafe(`
    SELECT count(*) AS inserted,
           count(*) FILTER (WHERE embedded_at IS NOT NULL) AS embedded,
           count(*) FILTER (WHERE id_story IS NOT NULL) AS in_story,
           count(*) FILTER (WHERE COALESCE(published_at, created_at) < now() - interval '48 hours') AS older_than_window,
           count(*) FILTER (WHERE embedded_at IS NULL AND COALESCE(published_at, created_at) >= now() - interval '48 hours') AS waiting_in_window,
           count(DISTINCT lang) AS languages,
           count(DISTINCT medium) AS media,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM embedded_at - created_at)) AS median_s_to_vector
    FROM articles WHERE created_at > now() - interval '24 hours'`)));
console.log('== waiting in the 48 h window ==', n(await prisma.$queryRawUnsafe(`
    SELECT count(*) FILTER (WHERE embedded_at IS NULL) AS waiting, count(*) AS news
    FROM articles WHERE COALESCE(published_at, created_at) >= now() - interval '48 hours'`)));
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

// 2. the profile, as briefing-service.js write() does it
const profile = await ProfileModel.get(profileId);
const interests = await ProfileModel.briefingInterests(profileId);
const language = readerLanguage(profile);
const own = await prisma.$queryRawUnsafe(`SELECT origin, count(*)::int AS n FROM user_feeds WHERE id_profile = $1 GROUP BY 1`, profileId);
const shared = [...new Set(Object.values(rss).flatMap(categories => Object.values(categories).flat()))];
const searches = await searchesOfUser(profileId);
console.log(`\n== profile ${profileId} == reads in ${language}, text ${profile.text.length} chars, interests ${interests.length}, refused ${(profile.refused ?? []).length}`);
console.log('own feeds', own.map(r => `${r.origin} ${r.n}`).join(', '), `| shared feeds ${shared.length} | Google searches ${searches.length}`);
interests.forEach(i => console.log(`  interest ${i.id} (weight ${i.weight}): ${i.text.slice(0, 90)}`));

const feedback = await FeedbackService.of(profileId);
const refused = new Set(feedback.refused);
const allFeeds = await feedsOf(profileId);
const feedUrls = allFeeds.filter(u => !refused.has(u));
const trusted = new Set(await FeedModel.trustedMedia(profileId));
const mediumOfArticle = (a) => mediumOf(hostOf(a.source_url ?? a.link) ?? '');
const media = new Set(await FeedModel.feedMedia());
const readableNow = (story) => googleAvailable('articles') || story.members.some(a => !isGoogleNewsUrl(a.feed_url) || a.resolved_link);
console.log(`feeds read ${feedUrls.length} (of ${allFeeds.length}, refused ${refused.size}), trusted media ${trusted.size}`);

for (const hours of [48, 168]) {
    const since = new Date(Date.now() - hours * 3600e3);
    console.log(`\n== window ${hours} h ==`, n(await prisma.$queryRawUnsafe(`
        SELECT count(DISTINCT a.link) AS news, count(DISTINCT a.lang) AS languages,
               count(DISTINCT a.link) FILTER (WHERE a.lang = $3) AS in_reader_language,
               count(DISTINCT a.id_story) AS stories
        FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = ANY($1) AND COALESCE(a.published_at, a.created_at) >= $2 AND a.id_story IS NOT NULL`, feedUrls, since, language)));

    let t = Date.now();
    const pool = await StoryModel.rank({profileId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: 600});
    const rankMs = Date.now() - t;
    const ranked = shareOut(pool, 150, row => row.id_interest, interests);
    const perInterest = interests.map(i => ranked.filter(r => r.id_interest === i.id).length);
    console.log(`ranked ${pool.length} in ${rankMs} ms, shared out ${ranked.length} (${perInterest.join(' + ')}), scores ${Number(pool[0]?.score).toFixed(3)} .. ${Number(pool.at(-1)?.score).toFixed(3)}; kept ${Math.min(...ranked.map(r => Number(r.score))).toFixed(3)} and up`);
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const stories = ranked.map((r, rank) => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news,
                score: Number(r.score), told: news.some(a => trusted.has(mediumOfArticle(a))), pooled: rank < 60};
    });
    const credible = stories.filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members) && readableNow(s)).sort((a, b) => b.score - a.score);

    // the stories sent by e-mail in the last 48 h left out, unless they evolved (one call of the AI)
    let fresh = credible, left = 0, back = 0;
    const shown = shownStories(await BriefingModel.sentSince(profileId, new Date(Date.now() - REPEAT_HOURS * 3600e3)));
    if (shown.size > 0) {
        const threads = await StoryModel.threadsOf([...new Set([...credible.map(s => s.storyId), ...shown.keys()])]);
        const result = await withoutRepeats(credible, shown, new Map(threads.map(r => [r.id, r.id_thread])), (asked) => evolvedStories(asked));
        [fresh, left, back] = [result.stories, result.left, result.back.length];
    }
    let choosable = fresh;
    if (hours >= 72) {
        const threads = new Map((await StoryModel.threadsOf(fresh.map(s => s.storyId))).map(row => [row.id, row.id_thread]));
        const seen = new Set();
        choosable = fresh.filter(s => {
            const thread = threads.get(s.storyId);
            if (thread == null) return true;
            if (seen.has(thread)) return false;
            seen.add(thread);
            return true;
        });
    }
    const closest = pickCandidates(choosable, {fromFeeds: 40, extra: 10, perMedium: 2,
        first: (list, size) => shareOut(list, size, s => s.interestId, interests)});
    const kept = new Set([...closest, ...choosable.filter(s => s.told && s.pooled && !closest.includes(s)).slice(0, 10)]);
    const candidates = choosable.filter(s => kept.has(s));
    const google = candidates.filter(s => s.members.every(a => isGoogleNewsUrl(a.feed_url))).length;
    console.log(`credible ${credible.length}, sent before left out ${left} (back ${back}) -> ${fresh.length}, once per thread ${choosable.length}, candidates ${candidates.length} (closest ${closest.length}, trusted extra ${candidates.length - closest.length}, Google only ${google}), told by a trusted medium ${candidates.filter(s => s.told).length}, languages ${new Set(candidates.map(s => s.best.lang)).size}, articles ${candidates.reduce((s, c) => s + c.members.length, 0)}, in ${Math.round((Date.now() - t) / 100) / 10} s`);
    if (hours !== 48) continue;

    t = Date.now();
    const chosen = await selectStories(profile.text, candidates.map(s => ({
        id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
        others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3), trusted: s.told,
        media: new Set(s.members.map(mediumOfArticle)).size,
    })), null, feedback.examples, interests.map(i => i.text), false, 10, language);
    const byId = new Map(candidates.map(s => [String(s.storyId), s]));
    const selected = balanceSelection(chosen, id => byId.get(id)?.interestId, interests, 10);
    console.log(`AI chose ${chosen.length}, balanced ${selected.length} + ${chosen.length - selected.length} in reserve in ${Date.now() - t} ms; in the reader's language ${selected.filter(x => byId.get(x.id).best.lang === language).length}, languages ${new Set(selected.map(x => byId.get(x.id).best.lang)).size}`);

    const toCheck = (s) => {
        const others = s.members.filter(a => a !== s.best).sort((a, b) => b.at - a.at);
        const seen = new Set([mediumOfArticle(s.best)]);
        const first = [], then = [];
        for (const a of others) { (seen.has(mediumOfArticle(a)) ? then : first).push(a); seen.add(mediumOfArticle(a)); }
        return [...first, ...then].slice(0, 12);
    };
    const brief = (a, c) => ({title: a.title, description: (a.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, c)});
    const picked = chosen.map(item => byId.get(item.id));
    const asked = picked.map(s => ({s, others: toCheck(s)})).filter(x => x.others.length > 0);
    t = Date.now();
    const [checked, merges] = await Promise.all([
        checkStories(asked.map(({s, others}) => ({id: String(s.storyId), lead: brief(s.best, 200), others: others.map(a => brief(a, 150))}))),
        mergeStories(picked.map(s => ({id: String(s.storyId), lead: brief(s.best, 200)}))),
    ]);
    const checkedOthers = asked.reduce((sum, x) => sum + x.others.length, 0);
    const keptOthers = asked.reduce((sum, x) => sum + (checked.get(String(x.s.storyId))?.size ?? x.others.length), 0);
    console.log(`check+merge (cards and reserve) in ${Date.now() - t} ms: checked ${checkedOthers}, kept ${keptOthers}; stories joined ${merges.size} -> ${picked.length - merges.size} (versions in other languages not replayed)`);
}

// 3. one sentence search
if (sentence) {
    const seen = {};
    const closestArticles = FeedModel.closestArticles;
    FeedModel.closestArticles = async (args) => {
        const rows = await closestArticles(args);
        seen.candidates = rows.length;
        seen.languages = new Set(rows.map(r => r.lang)).size;
        seen.lines = new Set(rows.map(r => r.id_story != null ? `s${r.id_story}` : `t${r.title}`)).size;
        return rows;
    };
    const t = Date.now();
    const found = await NewsService.getNews({keywords: [sentence], category: FeedService.categories(language), profileId, language,
        timeframe: {start: new Date(Date.now() - 7 * 864e5)}});
    const answers = found.news.filter(c => c.match === 'answer').length;
    console.log(`\n== search "${sentence}" (${language}, 7 days) in ${Date.now() - t} ms ==`, seen,
        `cards ${found.news.length} (answers ${answers}, related ${found.news.length - answers}), joined sources ${found.news.reduce((s, c) => s + (c.sources?.length ?? 0), 0)}`);
}
process.exit(0);
