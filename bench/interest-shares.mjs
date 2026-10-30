// Per interest of a reader (482), over 24 h and 48 h: the stories ranked, credible, made candidates, and the AI choice (2 runs, 24 h). Read only
//   node --env-file=.env bench/interest-shares.mjs
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, selectStories} from '../services/utils/profile-ai.js';
import {credibleStory, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const userId = 482;
const profile = await ProfileModel.get(userId);
const interests = await ProfileModel.interests(userId);
const name = new Map(interests.map(i => [i.id, i.text.split(':')[0].slice(0, 22)]));
const feedback = await FeedbackService.of(userId);
const refused = new Set(feedback.refused);
const shared = [...new Set(Object.values(rss).flatMap(c => Object.values(c).flat()))];
const feedUrls = [...new Set([...shared, ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])].filter(u => !refused.has(u));
const media = new Set(await FeedModel.feedMedia());
const per = (list, of) => interests.map(i => `${name.get(i.id)} ${list.filter(x => of(x) === i.id).length}`).join(' | ');
interests.forEach(i => console.log(`interest ${i.id} weight ${i.weight}: ${i.text}`));

for (const hours of [24, 48]) {
    const since = new Date(Date.now() - hours * 3600e3);
    const ranked = await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit: 600});
    const top = ranked.slice(0, 150);
    console.log(`\n== ${hours} h == ranked 600: ${per(ranked, r => r.id_interest)}`);
    console.log(`top 150: ${per(top, r => r.id_interest)}`);
    for (const i of interests) {
        const s = ranked.filter(r => r.id_interest === i.id).map(r => Number(r.score));
        console.log(`  ${name.get(i.id)}: best ${s[0]?.toFixed(3)}, 10th ${s[9]?.toFixed(3)}, 30th ${s[29]?.toFixed(3)}; cut of the 150 at ${Number(top.at(-1).score).toFixed(3)}`);
    }
    const members = new Map(top.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    const stories = top.map(r => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest, members: news, score: Number(r.score)};
    });
    const credible = stories.filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members));
    const candidates = pickCandidates(credible, {fromFeeds: 40, extra: 10, perMedium: 2});
    console.log(`credible: ${per(credible, s => s.interestId)}`);
    console.log(`candidates ${candidates.length}: ${per(candidates, s => s.interestId)}`);
    const ref = interests[1].id;
    candidates.filter(s => s.interestId === ref).forEach(s => console.log(`   ref cand ${s.score.toFixed(3)} [${s.best.lang}] ${s.best.title.slice(0, 110)}`));
    stories.filter(s => s.interestId === ref && !candidates.includes(s)).slice(0, 12).forEach(s => console.log(`   ref left ${s.score.toFixed(3)} [${s.best?.lang}] ${s.best?.title?.slice(0, 100)}`));
    if (hours !== 24) continue;
    const byId = new Map(candidates.map(s => [String(s.storyId), s]));
    for (let run = 1; run <= 2; run++) {
        const chosen = await selectStories(profile.text, candidates.map(s => ({
            id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
            others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3), trusted: false,
            media: new Set(s.members.map(a => mediumOf(hostOf(a.source_url ?? a.link) ?? ''))).size,
        })), null, feedback.examples, interests.map(i => i.text), false);
        const kept = balanceSelection(chosen, id => byId.get(id)?.interestId, interests);
        console.log(`AI run ${run}: chose ${chosen.length}: ${per(chosen, x => byId.get(x.id)?.interestId)}; kept ${kept.length}: ${per(kept, x => byId.get(x.id)?.interestId)}`);
        chosen.filter(x => byId.get(x.id)?.interestId === ref).forEach(x => console.log(`   ref chosen: ${byId.get(x.id).best.title.slice(0, 100)}`));
    }
}
process.exit(0);
