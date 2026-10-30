// Read only: the sentences with a verb of denial bench/contested-versions.mjs found (world news and
// briefing cards) given again to services/utils/contested.js, to compare its prompt with the one of the
// bench. No page read again, no translation. Written to bench/data/contested-replay.txt
//   node --env-file=.env bench/contested-replay.mjs
import process from 'node:process';
import fs from 'node:fs';
import {newUsage} from '../services/utils/ollama.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
// the AI asked again after a failure (Ollama over its quota, Gemini answering an error 500)
const retried = async (ask) => {
    for (let attempt = 1; ; attempt++) {
        try {
            return await ask();
        } catch (err) {
            if (attempt === 5) throw err;
            await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        }
    }
};
import {contestedOf} from '../services/utils/contested.js';

const usage = newUsage();
const stories = JSON.parse(fs.readFileSync(new URL('./data/contested-versions.json', import.meta.url), 'utf8'))
    .filter(story => story.contested.length > 0);
const before = (c) => c.denial === true && c.denied_by && c.about === 'main';
const results = await mapWithConcurrency(stories, 2, async (story) => {
    const byMedium = new Map();
    for (const c of story.contested) byMedium.set(c.medium, [...(byMedium.get(c.medium) ?? []), c.sentence]);
    const texts = [...byMedium].map(([medium, sentences]) => ({source: medium, url: medium, publishedAt: null,
        page: {content: sentences.join(' '), blocks: sentences.map(text => ({kind: 'text', text}))}}));
    return {story, now: await retried(() => contestedOf(story.title, texts, {language: 'xx', usage}))};
});
const lines = [];
let was = 0, is = 0;
for (const r of results) {
    if (r.status !== 'fulfilled') { lines.push(`failed ${r.reason}`); continue; }
    const {story, now} = r.value;
    const old = story.contested.filter(before);
    was += old.length > 0; is += now.length > 0;
    if (old.length === 0 && now.length === 0) continue;
    lines.push(`#${story.storyId} [${story.from}] ${story.title.slice(0, 100)}`);
    for (const c of old) lines.push(`  before: ${c.denied_by} — «${c.sentence.slice(0, 200)}»`);
    for (const c of now) lines.push(`  now:    ${c.by} — ${c.source}: «${c.sentence.slice(0, 200)}»`);
}
lines.unshift(`cards shown before ${was}, now ${is}, tokens ${JSON.stringify(usage)}\n`);
fs.writeFileSync(new URL('./data/contested-replay.txt', import.meta.url), lines.join('\n') + '\n');
console.log(lines[0]);
process.exit(0);
