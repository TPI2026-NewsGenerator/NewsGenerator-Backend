// The merge of the cards of one news (mergeStories, services/utils/profile-ai.js) replayed on the cards of the
// briefings already written: which cards the AI would join now, to be read by hand against the pairs that were
// left as two cards (the user, 03.11.2026: cards 1 and 2 of Enzo's briefing the same news). Read only; the
// description of each lead is read from its article.
//   node --env-file=.env bench/merge-replay.mjs <briefingId>[,<briefingId>...] [variant=current]
import process from 'node:process';
import pg from 'pg';
import {mergePrompt, normalizeMerges} from '../services/utils/profile-ai.js';
import {ollamaJson} from '../services/utils/ollama.js';

const ids = (process.argv[2] ?? '').split(',').map(Number).filter(Boolean);
const variant = process.argv[3] ?? 'current';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();

// variant 'redundant': the question is whether reading the card above leaves nothing to learn here
const redundantPrompt = (stories) => mergePrompt(stories)
    .replace("Dans le doute, ce n'est pas le même fait : réponds null. Fusionner à tort cache une nouvelle au lecteur.",
        "Une histoire à laquelle la carte du dessus répond déjà, parce qu'elle annonce, commente ou reprend la même décision, la même déclaration ou le même événement, est le même fait. Si elle dit un fait de plus (un autre résultat, une autre décision, une autre déclaration), réponds null.");
const prompts = {current: mergePrompt, redundant: redundantPrompt};

for (const id of ids) {
    const {rows: [briefing]} = await client.query('SELECT items FROM briefings WHERE id = $1', [id]);
    const stories = [];
    for (const item of briefing.items.filter(item => item.storyId > 0)) {
        const {rows: [article]} = await client.query('SELECT title, description FROM articles WHERE link = $1 LIMIT 1', [item.lead?.url]);
        stories.push({id: String(item.storyId), lead: {title: article?.title ?? item.title, description: (article?.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}});
    }
    const merges = normalizeMerges(await ollamaJson(prompts[variant](stories)), stories);
    const title = new Map(stories.map((story, i) => [story.id, `#${i + 1} ${story.lead.title.slice(0, 90)}`]));
    console.log(`briefing ${id}: ${stories.length} cards, ${merges.size} would be joined`);
    for (const [from, into] of merges) console.log(`   ${title.get(from)}\n     -> ${title.get(into)}`);
}
await client.end();
