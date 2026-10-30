// Replays the ranking and the choice of a briefing (steps 1 and 2 of briefing-service.js) for a user
// (env USER_ID), as it is, with some of their sources trusted (env TRUST, sites comma separated), and
// with thumbs up on some titles (env LIKED, titles separated by "|"). Nothing is written: the trust and
// the thumbs are given to the replay only. Prints the stories told by a trusted source among the
// ranked ones, their rank and whether they are candidates, and the cards chosen in each case
import {rss} from '../db/rss-links.js';
import {prisma} from '../config/db.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {balanceSelection, normalizeSelection, selectionPrompt, selectStories} from '../services/utils/profile-ai.js';
import {ollamaJson} from '../services/utils/ollama.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const userId = Number(process.env.USER_ID);
const RUNS = Number(process.env.RUNS ?? 2);
const [profile, interests] = await Promise.all([ProfileModel.get(userId), ProfileModel.interests(userId)]);
const feedback = await FeedbackService.of(userId);
const refused = new Set(feedback.refused);
const feedUrls = [...new Set([
    ...Object.values(rss).flatMap(categories => Object.values(categories).flat()),
    ...await FeedModel.userFeedUrls(userId),
    ...await searchesOfUser(userId),
])].filter(url => !refused.has(url));
const sites = (process.env.TRUST ?? '').split(',').filter(Boolean);
// as FeedModel.trustedMedia, for the sites given
const trustRows = (await prisma.$queryRawUnsafe(`
    SELECT uf.site,
           (SELECT a.medium FROM articles a JOIN feeds f ON f.id = a.id_feed
            WHERE f.url = uf.url AND a.source_url IS NULL AND a.medium IS NOT NULL
            GROUP BY a.medium ORDER BY count(*) DESC LIMIT 1) AS medium
    FROM user_feeds uf WHERE uf.id_user = $1`, userId)).filter(row => sites.some(site => row.site === site || row.site.endsWith(`.${site}`)));
const trustMedia = new Set(trustRows.flatMap(row => [mediumOf(row.site.replace(/^www\./, '')), row.medium].filter(Boolean)));
console.log(`trusted media: ${[...trustMedia].join(', ')}, real ones of the user: ${(await FeedModel.trustedMedia(userId)).join(', ') || 'none'}`);
const mediumOfArticle = (article) => mediumOf(hostOf(article.source_url ?? article.link) ?? '');
const liked = (process.env.LIKED ?? '').split('|').map(title => title.trim()).filter(Boolean);

const since = new Date(Date.now() - 48 * 3600e3);
const ranked = await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: 150});
const members = new Map(ranked.map(row => [row.id_story, []]));
for (const article of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(article.id_story).push(article);
const media = new Set(await FeedModel.feedMedia());

// as briefing-service.js: the stories of a trusted medium among the 60 closest are candidates besides the 40
const candidatesWith = (trusted) => {
    const byId = new Map(ranked.map((row, rank) => {
        const news = members.get(row.id_story);
        const told = news.some(article => trusted.has(mediumOfArticle(article)));
        return [String(row.id_story), {
            storyId: row.id_story, rank, told, trusted: rank < 60 && told,
            best: news.find(article => article.id === row.id_article) ?? news[0],
            interestId: row.id_interest, members: news, score: Number(row.score),
        }];
    }));
    const choosable = [...byId.values()]
        .filter(story => story.best && credibleStory(story.members, media) && !isRepeatedPage(story.members))
        .sort((a, b) => b.score - a.score);
    const closest = pickCandidates(choosable, {fromFeeds: 40, extra: 10, perMedium: 2});
    const kept = new Set([...closest, ...choosable.filter(story => story.trusted && !closest.includes(story)).slice(0, 10)]);
    return {byId, candidates: choosable.filter(story => kept.has(story))};
};

// told: the AI is told which stories a trusted medium tells (the measured variant)
const TRUSTED_MARK = ' (source de confiance du lecteur)';
const TRUSTED_RULE = `Les histoires marquées « source de confiance du lecteur » sont racontées par un média qu'il a mis en favori : à pertinence égale, préfère-les. Ne choisis jamais pour cela une histoire qui ne correspond pas à ce qu'il demande.
`;
const choose = async ({byId, candidates}, examples, told = false) => {
    const given = candidates.map(story => ({
        id: String(story.storyId), title: story.best.title + (told && story.told ? TRUSTED_MARK : ''),
        description: (story.best.description ?? '').slice(0, 200),
        others: story.members.filter(article => article !== story.best).map(article => article.title).slice(0, 3),
    }));
    const texts = interests.map(interest => interest.text);
    const chosen = told
        ? normalizeSelection(await ollamaJson(selectionPrompt(profile.text, given, examples, texts).replace('Varie :', `${TRUSTED_RULE}Varie :`)), given.map(c => c.id))
        : await selectStories(profile.text, given, null, examples, texts);
    return balanceSelection(chosen, id => byId.get(id)?.interestId, interests).map(item => byId.get(item.id));
};

const base = candidatesWith(new Set());
if (process.env.PRINT_SITES) {
    for (const story of [...base.byId.values()].filter(story => story.rank >= 35 && story.rank < 75)) {
        const sites = [...new Set(story.members.map(article => (article.medium ?? new URL(article.link).hostname).replace(/^www\./, '')))];
        console.log(`#${story.rank + 1} ${story.best.title.slice(0, 60)} | ${sites.slice(0, 6).join(' ')}`);
    }
    process.exit(0);
}
const trust = candidatesWith(trustMedia);
const inBase = new Set(base.candidates.map(story => story.storyId));
const inTrust = new Set(trust.candidates.map(story => story.storyId));
console.log(`\nstories told by a trusted source among the ${ranked.length} ranked (rank, candidate without -> with trust):`);
for (const story of trust.byId.values()) {
    if (!story.told) continue;
    console.log(`  #${String(story.rank + 1).padStart(3)} ${inBase.has(story.storyId) ? 'C' : '-'} -> ${inTrust.has(story.storyId) ? 'C' : '-'}  ${story.best.title.slice(0, 95)}`);
}

const examples = {liked: [...feedback.examples.liked], refused: [...feedback.examples.refused]};
const cases = [
    ['as it is', base, examples, false],
    ['trusted', trust, examples, false],
    ['trusted, the AI told', trust, examples, true],
    ...(liked.length > 0 ? [['thumbs up', base, {liked: [...liked, ...examples.liked], refused: examples.refused}, false]] : []),
].filter(([name]) => !process.env.CASES || process.env.CASES.split('|').includes(name));
for (const [name, set, given, told] of cases) {
    for (let run = 1; run <= RUNS; run++) {
        const cards = await choose(set, given, told);
        console.log(`\n${name}, run ${run}: ${cards.length} cards`);
        for (const card of cards) console.log(`  ${card.told ? 'T' : ' '} i${interests.findIndex(interest => interest.id === card.interestId)} #${String(card.rank + 1).padStart(3)} ${card.best.title.slice(0, 95)}`);
    }
}
await prisma.$disconnect();
process.exit(0);
