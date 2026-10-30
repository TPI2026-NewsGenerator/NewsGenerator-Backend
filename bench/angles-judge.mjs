// What the AI answers for each candidate of the Latvian card (see angles-latvia.mjs): the list it gets
// rebuilt as anglesOf builds it, its answer printed. node --env-file=.env bench/angles-judge.mjs
import {feedsOf} from '../services/briefing-service.js';
import {StoryModel} from '../models/story-model.js';
import {MentionModel} from '../models/mention-model.js';
import {anglesPrompt} from '../services/utils/other-angles.js';
import {ollamaJson, newUsage} from '../services/utils/ollama.js';
import {prisma} from '../config/db.js';
const storyId = 647742;
const feedUrls = await feedsOf(7);
const month = new Date(Date.now() - 30 * 864e5);
const members = await StoryModel.storyArticles({storyIds: [storyId], feedUrls, since: month});
const close = await StoryModel.closeStories({storyIds: [storyId], excluded: [storyId], feedUrls, since: new Date(Date.now() - 3 * 864e5), likeness: 0.6, perStory: 16});
const named = await MentionModel.storiesNaming({storyId, likeness: 0.45, mentionIds: (await prisma.$queryRawUnsafe(`SELECT id FROM mentions WHERE key IN ('lff', 'latvijas futbola federacija')`)).map(r => r.id),
    qids: ['Q630231'], feedUrls, since: month, excluded: [storyId], limit: 13});
const ids = [...new Set([...close.map(r => r.id_other), ...named.map(r => r.id_story)])];
const news = await StoryModel.storyArticles({storyIds: ids, feedUrls, since: month});
const first = (id) => news.find(a => a.id_story === id);
const closest = close.filter(r => first(r.id_other)).slice(0, 8);
const others = [...closest.map(r => ({...first(r.id_other), how: `close ${r.likeness.toFixed(2)}`})),
    ...named.filter(r => !closest.some(c => c.id_other === r.id_story)).slice(0, 5)
        .map(r => ({...(news.find(a => a.id === r.id_article) ?? first(r.id_story)), how: `named ${r.likeness.toFixed(2)}`}))];
// VARIANT: 0 as built, 1 with the card's title in English among its titles, 2 and the sentence on stances
const variant = Number(process.env.VARIANT ?? 0);
const english = "LFF will support Čeferin's candidacy for a fourth term as UEFA president";
let prompt = anglesPrompt(members[0].title, others, variant >= 1 && variant !== 3 ? [english] : [], members[0].at);
if (variant >= 2) {
    prompt = prompt.replace("another party's view.", "another party's view, an earlier or later stance of one of its actors on the same contest or\n  dispute, even weeks apart (a body backing one side, then the other).");
    if (!prompt.includes('weeks apart')) throw new Error('variant not applied');
}
const answer = await ollamaJson(prompt, newUsage());
others.forEach((other, i) => console.log(`${(answer.news ?? []).find(n => Number(n.n) === i + 1)?.kind ?? '?'}\t${other.how}\t${other.at.toISOString().slice(0, 10)} ${other.title.slice(0, 100)}`));
await prisma.$disconnect();
process.exit(0);
