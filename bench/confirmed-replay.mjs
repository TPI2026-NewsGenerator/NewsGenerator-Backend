// A briefing "confirmed only" replayed against the briefing of today, nothing saved: the stories of the
// reader ranked as briefing-service.js write() does (24 h and 48 h), the candidates as they are, and
// the candidates kept to the stories told by 2 media or more (ranked deeper, RANKED_CONFIRMED). The AI
// chooses in both; the titles chosen by one mode only are written for reading by hand.
//   node --env-file=.env bench/confirmed-replay.mjs [userId ...]
import process from 'node:process';
import fs from 'node:fs';
import {prisma} from '../config/db.js';
import {rss} from '../db/rss-links.js';
import {ProfileModel} from '../models/profile-model.js';
import {FeedModel} from '../models/feed-model.js';
import {StoryModel} from '../models/story-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {balanceSelection, selectStories} from '../services/utils/profile-ai.js';
import {credibleStory, isPlatform, isRepeatedPage, pickCandidates} from '../services/utils/google-news.js';
import {hostOf, mediumOf} from '../services/utils/public-url.js';

const USERS = process.argv.slice(2).map(Number);
const users = USERS.length ? USERS : [482, 4, 154, 129, 384, 290, 389];
const RANKED = 150;
const RANKED_CONFIRMED = 400;
const MIN_MEDIA = 2;
const out = [];
const log = (...args) => { const line = args.join(' '); console.log(line); out.push(line); };

const mediumOfArticle = (a) => mediumOf(hostOf(a.source_url ?? a.link) ?? '');
const mediaOf = (story) => new Set(story.members
    .filter(a => !isPlatform(a.source_url ?? a.link))
    .map(mediumOfArticle).filter(Boolean)).size;
const media = new Set(await FeedModel.feedMedia());
const shared = [...new Set(Object.values(rss).flatMap(categories => Object.values(categories).flat()))];
const mean = (xs) => xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3) : '-';

const storiesOf = async ({userId, feedUrls, since, trusted, limit}) => {
    const ranked = await StoryModel.rank({userId, feedUrls, since, languages: null, sparseWeight: 0.5, limit});
    const members = new Map(ranked.map(r => [r.id_story, []]));
    for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
    return ranked.map((r, rank) => {
        const news = members.get(r.id_story);
        return {storyId: r.id_story, best: news.find(a => a.id === r.id_article) ?? news[0], interestId: r.id_interest,
                members: news, score: Number(r.score), told: news.some(a => trusted.has(mediumOfArticle(a))), pooled: rank < 60};
    }).filter(s => s.best && credibleStory(s.members, media) && !isRepeatedPage(s.members))
        .sort((a, b) => b.score - a.score);
};

const candidatesOf = (choosable) => {
    const closest = pickCandidates(choosable, {fromFeeds: 40, extra: 10, perMedium: 2});
    const kept = new Set([...closest, ...choosable.filter(s => s.told && s.pooled && !closest.includes(s)).slice(0, 10)]);
    return choosable.filter(s => kept.has(s));
};

const choose = async (profile, feedback, interests, candidates) => {
    const chosen = await selectStories(profile.text, candidates.map(s => ({
        id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
        others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3), trusted: s.told, media: mediaOf(s),
    })), null, feedback.examples, interests.map(i => i.text), false);
    const byId = new Map(candidates.map(s => [String(s.storyId), s]));
    return balanceSelection(chosen, id => byId.get(id)?.interestId, interests).map(item => byId.get(item.id)).filter(Boolean);
};

for (const userId of users) {
    const profile = await ProfileModel.get(userId);
    const interests = await ProfileModel.interests(userId);
    const feedback = await FeedbackService.of(userId);
    const refused = new Set(feedback.refused);
    const searches = await searchesOfUser(userId);
    const feedUrls = [...new Set([...shared, ...await FeedModel.userFeedUrls(userId), ...searches])].filter(u => !refused.has(u));
    const trusted = new Set(await FeedModel.trustedMedia(userId));
    log(`\n== reader ${userId} == interests ${interests.length}, feeds ${feedUrls.length}`);

    for (const hours of [24, 48]) {
        const since = new Date(Date.now() - hours * 3600e3);
        const normal = await storiesOf({userId, feedUrls, since, trusted, limit: RANKED});
        const deep = await storiesOf({userId, feedUrls, since, trusted, limit: RANKED_CONFIRMED});
        const confirmedIn150 = normal.filter(s => mediaOf(s) >= MIN_MEDIA);
        const confirmed = deep.filter(s => mediaOf(s) >= MIN_MEDIA);

        const candN = candidatesOf(normal);
        const candC = candidatesOf(confirmed);
        const [pickN, pickC] = await Promise.all([
            choose(profile, feedback, interests, candN),
            choose(profile, feedback, interests, candC),
        ]);
        const idsN = new Set(pickN.map(s => s.storyId));
        const idsC = new Set(pickC.map(s => s.storyId));
        const both = pickC.filter(s => idsN.has(s.storyId)).length;
        log(`-- ${hours} h: ranked 150 -> credible ${normal.length} (2+ media ${confirmedIn150.length}); ranked 400 -> 2+ media ${confirmed.length}`);
        log(`   normal:    candidates ${candN.length} (2+ media ${candN.filter(s => mediaOf(s) >= MIN_MEDIA).length}), cards ${pickN.length}, 2+ media ${pickN.filter(s => mediaOf(s) >= MIN_MEDIA).length}, score ${mean(pickN.map(s => s.score))}, rank-score of 40th candidate ${candN.at(-1)?.score.toFixed(3) ?? '-'}`);
        log(`   confirmed: candidates ${candC.length}, cards ${pickC.length}, score ${mean(pickC.map(s => s.score))}, 40th ${candC.at(-1)?.score.toFixed(3) ?? '-'}, cards in both ${both}`);
        for (const s of pickN.filter(s => !idsC.has(s.storyId))) log(`   only normal    [${mediaOf(s)} media, ${s.score.toFixed(3)}] ${s.best.title}`);
        for (const s of pickC.filter(s => !idsN.has(s.storyId))) log(`   only confirmed [${mediaOf(s)} media, ${s.score.toFixed(3)}] ${s.best.title}`);
    }
}
fs.writeFileSync(new URL('./data/confirmed-replay.txt', import.meta.url), out.join('\n') + '\n');
process.exit(0);
