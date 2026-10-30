// the choice of the AI for a reader now, as a briefing makes it, run several times: how the chosen
// stories spread over the interests. node bench/select.mjs <userId> [runs] [titles]
import 'dotenv/config';
import fs from 'node:fs';
import {rss} from '../db/rss-links.js';
import {StoryModel} from '../models/story-model.js';
import {FeedModel} from '../models/feed-model.js';
import {ProfileModel} from '../models/profile-model.js';
import {BriefingModel} from '../models/briefing-model.js';
import {FeedbackService} from '../services/feedback-service.js';
import {searchesOfUser} from '../services/ingest-service.js';
import {credibleStory, pickCandidates} from '../services/utils/google-news.js';
import {balanceSelection, selectStories} from '../services/utils/profile-ai.js';
import {newUsage} from '../services/utils/ollama.js';

const [userId, runs = 3] = process.argv.slice(2).map(Number);
const profile = await ProfileModel.get(userId);
const interests = await ProfileModel.interests(userId);
const since = new Date(Date.now() - 48 * 3600e3);
const feedback = await FeedbackService.of(userId);
const refused = new Set(feedback.refused);
const feedUrls = [...new Set([...profile.languages.flatMap(l => Object.values(rss[l] ?? {}).flat()), ...await FeedModel.userFeedUrls(userId), ...await searchesOfUser(userId)])].filter(url => !refused.has(url));
const shown = await BriefingModel.shownCards(userId, new Date(Date.now() - 72 * 3600e3));
const ranked = await StoryModel.rank({userId, feedUrls, since, languages: profile.languages, sparseWeight: 0.5, excluded: shown.flatMap(c => c.storyIds).filter(Number.isInteger), limit: 150});
const members = new Map(ranked.map(r => [r.id_story, []]));
for (const a of await StoryModel.storyArticles({storyIds: [...members.keys()], feedUrls, since})) members.get(a.id_story).push(a);
const media = new Set(await FeedModel.feedMedia());
const stories = ranked.map(r => ({storyId: r.id_story, interest: r.id_interest, score: Number(r.score), best: members.get(r.id_story).find(a => a.id === r.id_article), members: members.get(r.id_story)}));
// FROZEN=file: the candidates saved there are read again, so that several models choose among the same
const frozen = process.env.FROZEN && fs.existsSync(process.env.FROZEN) ? JSON.parse(fs.readFileSync(process.env.FROZEN, 'utf8')) : null;
const candidates = frozen ?? pickCandidates(stories.filter(s => s.best && credibleStory(s.members, media)), {fromFeeds: 40, extra: 10, perMedium: 2});
if (process.env.FROZEN && !frozen) fs.writeFileSync(process.env.FROZEN, JSON.stringify(candidates));
const byId = new Map(candidates.map(s => [String(s.storyId), s]));
const name = (id) => interests.find(i => i.id === id)?.text.split(':')[0].trim().slice(0, 14);
const spread = (list) => interests.map(i => `${name(i.id)} ${list.filter(s => s.interest === i.id).length}`).join(', ');
console.log(`candidates ${candidates.length}: ${spread(candidates)}`);
for (let run = 0; run < runs; run++) {
    const usage = newUsage();
    const selected = await selectStories(profile.text, candidates.map(s => ({
        id: String(s.storyId), title: s.best.title, description: (s.best.description ?? '').slice(0, 200),
        others: s.members.filter(a => a !== s.best).map(a => a.title).slice(0, 3), trusted: false,
    })), usage, feedback.examples, interests.map(i => i.text));
    const kept = balanceSelection(selected, id => byId.get(id)?.interest, interests).map(item => byId.get(item.id));
    const chosen = selected.map(item => byId.get(item.id));
    console.log(`run ${run}: ${chosen.length} chosen, ${spread(chosen)}, kept ${kept.length}: ${spread(kept)}  (${usage.input}+${usage.output} tokens)`);
    if (process.argv[4]) chosen.forEach(s => console.log(`   ${kept.includes(s) ? 'K' : ' '} ${name(s.interest)} | ${s.best.title.slice(0, 100)}`));
}
process.exit(0);
