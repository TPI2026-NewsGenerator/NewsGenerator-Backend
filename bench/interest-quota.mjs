// The candidates of a briefing with and without a share for each interest, on several readers, 24 h:
// how many per interest, and what the AI keeps of them. Read only, nothing saved
//   node --env-file=.env bench/interest-quota.mjs [userId ...]
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, selectStories} from '../services/utils/profile-ai.js';
import {credibleStory, isGoogleNewsUrl, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const users = process.argv.slice(2).map(Number);
const HOURS = Number(process.env.HOURS ?? 24);
const media = new Set(await FeedModel.feedMedia());
const shared = [...new Set(Object.values(rss).flatMap(c => Object.values(c).flat()))];
const onlyGoogle = (story) => story.members.every(article => isGoogleNewsUrl(article.feed_url));

// the 'size' first of 'list', each interest first given its share by weight of them (its best ones),
// then the places left to the next whatever their interest; in the order of 'list'
const shareOut = (list, size, interests) => {
    const total = interests.reduce((sum, interest) => sum + interest.weight, 0);
    const kept = new Set();
    for (const interest of interests) {
        const share = Math.floor(size * interest.weight / total);
        list.filter(story => story.interestId === interest.id).slice(0, share).forEach(story => kept.add(story));
    }
    for (const story of list) if (kept.size < size) kept.add(story);
    return list.filter(story => kept.has(story));
};
const withShares = (stories, interests) => {
    const fromFeeds = shareOut(stories.filter(story => !onlyGoogle(story)), 40, interests);
    const google = pickCandidates(stories.filter(onlyGoogle), {fromFeeds: 0, extra: 10, perMedium: 2});
    const kept = new Set([...fromFeeds, ...google]);
    return stories.filter(story => kept.has(story));
};

for (const userId of users) {
    const profile = await ProfileModel.get(userId);
    const interests = await ProfileModel.interests(userId);
    const name = new Map(interests.map(i => [i.id, i.text.split(/[:,(]/)[0].trim().slice(0, 24)]));
    const per = (list, of) => interests.map(i => `${name.get(i.id)} ${list.filter(x => of(x) === i.id).length}`).join(' | ');
    const feedback = await FeedbackService.of(userId);
    const refused = new Set(feedback.refused);
    const feedUrls = [...new Set([...shared, ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])].filter(u => !refused.has(u));
    const since = new Date(Date.now() - HOURS * 3600e3);

    const ranked = await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: 600});
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const all = ranked.map(r => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news, score: Number(r.score)};
    }).filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members));
    // as now: the 150 closest whatever their interest
    const top = new Set(ranked.slice(0, 150).map(r => r.id_story));
    const credible = all.filter(s => top.has(s.storyId));
    // the 150 shared out among the interests too
    const deepIds = new Set(shareOut(ranked.map(r => ({storyId: r.id_story, interestId: r.id_interest})), 150, interests).map(s => s.storyId));
    const deep = all.filter(s => deepIds.has(s.storyId));

    console.log(`\n===== user ${userId}, ${HOURS} h: ${interests.map(i => `${name.get(i.id)} (w ${i.weight})`).join(', ')}`);
    console.log(`ranked 600: ${per(ranked, r => r.id_interest)}`);
    console.log(`credible of the 150: ${per(credible, s => s.interestId)}; of the 150 shared: ${per(deep, s => s.interestId)}`);
    const variants = {
        now: pickCandidates(credible, {fromFeeds: 40, extra: 10, perMedium: 2}),
        shares: withShares(credible, interests),
        'shares 150 too': withShares(deep, interests),
    };
    for (const [label, candidates] of Object.entries(variants)) {
        console.log(`  candidates ${label} (${candidates.length}): ${per(candidates, s => s.interestId)}`);
    }
    if (process.env.NO_AI) continue;
    for (const label of ['now', 'shares 150 too']) {
        const candidates = variants[label];
        const byId = new Map(candidates.map(s => [String(s.storyId), s]));
        const chosen = await selectStories(profile.text, candidates.map(s => ({
            id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
            others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3), trusted: false,
            media: new Set(s.members.map(a => mediumOf(hostOf(a.source_url ?? a.link) ?? ''))).size,
        })), null, feedback.examples, interests.map(i => i.text), false);
        const kept = balanceSelection(chosen, id => byId.get(id)?.interestId, interests);
        console.log(`  AI ${label}: chose ${chosen.length} (${per(chosen, x => byId.get(x.id)?.interestId)}), cards ${kept.length} (${per(kept, x => byId.get(x.id)?.interestId)})`);
        kept.forEach(x => {
            const s = byId.get(x.id);
            console.log(`     [${name.get(s.interestId)}] ${s.score.toFixed(3)} [${s.best.lang}] ${s.best.title.slice(0, 105)}`);
        });
    }
}
process.exit(0);
