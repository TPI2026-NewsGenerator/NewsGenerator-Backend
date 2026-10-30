// the check of the stories (checkPrompt) against the 30 cards read by hand (data/legacy/tpl/cards.json and
// truth.json): Y = tells the news of the lead one (must be kept), N = another news (must go), A = the same
// affair, another development (either answer is fine)
// node bench/check.mjs [runs] [prompt module]   the module exports checkPrompt, the app's one by default
import 'dotenv/config';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Ollama} from 'ollama';
import {normalizeCheck} from '../services/utils/profile-ai.js';

const runs = Number(process.argv[2] ?? 3);
const {checkPrompt} = await import(process.argv[3] ? pathToFileURL(process.argv[3]).href : '../services/utils/profile-ai.js');
const dir = new URL('./data/legacy/tpl/', import.meta.url);
const cards = JSON.parse(fs.readFileSync(new URL('cards.json', dir), 'utf8'));
const truth = JSON.parse(fs.readFileSync(new URL('truth.json', dir), 'utf8'));
// a call of Ollama cloud can stay unanswered for good (25 minutes on 13.10.2026): each request is given
// up after 120 s, an error as any other
const ollama = new Ollama({host: 'https://ollama.com', headers: {Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`},
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(120e3)})});

// the briefings sent the cards of one set in one call: the sets are sent as they were
const sets = Object.entries(truth).map(([name, labels]) => {
    const byId = new Map(cards[name].cards.map(card => [card.id, card]));
    return {name, stories: Object.keys(labels).map(id => ({id, lead: byId.get(id).lead, others: byId.get(id).others})), labels};
});

const total = {Y: 0, keptY: 0, N: 0, droppedN: 0, A: 0, keptA: 0};
const misses = new Map();
const tokens = {input: 0, output: 0, calls: 0};
for (let run = 0; run < runs; run++) {
    await Promise.all(sets.map(async ({name, stories, labels}) => {
        const response = await ollama.chat({model: process.env.OLLAMA_MODEL ?? 'gemma4:31b', format: 'json', ...(process.env.OLLAMA_THINK ? {think: ({true: true, false: false})[process.env.OLLAMA_THINK] ?? process.env.OLLAMA_THINK} : {}),  options: {temperature: 0.1},
            messages: [{role: 'user', content: checkPrompt(stories)}]});
        Object.assign(tokens, {input: tokens.input + response.prompt_eval_count, output: tokens.output + response.eval_count, calls: tokens.calls + 1});
        const checked = normalizeCheck(JSON.parse(response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')), stories);
        for (const story of stories) {
            const kept = checked.get(story.id) ?? new Set(story.others.map((_, i) => i + 1));
            [...labels[story.id]].forEach((label, i) => {
                const keep = kept.has(i + 1);
                total[label]++;
                if (label === 'Y' && keep) total.keptY++;
                if (label === 'N' && !keep) total.droppedN++;
                if (label === 'A' && keep) total.keptA++;
                if ((label === 'Y' && !keep) || (label === 'N' && keep)) {
                    const key = `${label === 'Y' ? 'dropped' : 'kept'}  ${name}/${story.id} P: ${story.lead.title.slice(0, 70)}\n        ${i + 1}. ${story.others[i].title.slice(0, 90)}`;
                    misses.set(key, (misses.get(key) ?? 0) + 1);
                }
            });
        }
    }));
}
const pct = (a, b) => `${(100 * a / b).toFixed(0)}%`;
console.log(`${runs} runs: Y kept ${pct(total.keptY, total.Y)} (${total.keptY}/${total.Y}), N dropped ${pct(total.droppedN, total.N)} (${total.droppedN}/${total.N}), A kept ${pct(total.keptA, total.A)}`);
console.log(`tokens per call: ${Math.round(tokens.input / tokens.calls)} read, ${Math.round(tokens.output / tokens.calls)} written`);
for (const [key, count] of [...misses].sort((a, b) => b[1] - a[1])) console.log(`  ×${count} ${key}`);
