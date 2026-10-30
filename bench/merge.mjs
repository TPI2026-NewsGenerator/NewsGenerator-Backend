// the merge of the cards (mergePrompt) against the lists of data/merge/lists.json (my labels): the pairs
// of one fact it merges, the pairs of two facts it merges by mistake
// node bench/merge.mjs [runs] [prompt module]   the module exports mergePrompt, the app's one by default
// SHOWN=40: the shown cards filled up to 40 with the stories of the other lists (other facts), as a
// reader of a few days has them
import 'dotenv/config';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Ollama} from 'ollama';
import {normalizeMerges} from '../services/utils/profile-ai.js';

const runs = Number(process.argv[2] ?? 3);
const {mergePrompt} = await import(process.argv[3] ? pathToFileURL(process.argv[3]).href : '../services/utils/profile-ai.js');
const lists = JSON.parse(fs.readFileSync(new URL('./data/merge/lists.json', import.meta.url), 'utf8'));
// a call of Ollama cloud can stay unanswered for good (25 minutes on 13.10.2026): each request is given
// up after 120 s, an error as any other
const ollama = new Ollama({host: 'https://ollama.com', headers: {Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`},
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(120e3)})});

// counted by story of the day: it must join a story above it when one tells the same fact, and none else.
// A join to a story of a 'maybe' pair is not counted
const total = {should: 0, joined: 0, alone: 0, wrong: 0, wrongShown: 0};
const misses = new Map();
const SHOWN = Number(process.env.SHOWN ?? 0);
const seconds = [];
const tokens = {input: 0, output: 0, calls: 0};
for (let run = 0; run < runs; run++) {
    await Promise.all(lists.map(async (list) => {
        // the app names the shown cards shown0, shown1... and the stories by their number
        const fillers = lists.filter(other => other !== list).flatMap(other => other.stories)
            .slice(0, Math.max(0, SHOWN - list.shown.length));
        const fact = {...list.fact, ...Object.fromEntries(fillers.map(s => [s.id, `other ${s.id}`]))};
        const shown = [...fillers, ...list.shown].map((s, i) => ({id: `shown${i}`, source: s.id, lead: {title: s.title, description: s.description}}));
        const stories = list.stories.map(s => ({id: s.id, source: s.id, lead: {title: s.title, description: s.description}}));
        const start = Date.now();
        const response = await ollama.chat({model: process.env.OLLAMA_MODEL ?? 'gemma4:31b', format: 'json', ...(process.env.OLLAMA_THINK ? {think: ({true: true, false: false})[process.env.OLLAMA_THINK] ?? process.env.OLLAMA_THINK} : {}),  options: {temperature: 0.1},
            messages: [{role: 'user', content: mergePrompt(stories, shown)}]});
        seconds.push((Date.now() - start) / 1000);
        Object.assign(tokens, {input: tokens.input + response.prompt_eval_count, output: tokens.output + response.eval_count, calls: tokens.calls + 1});
        const merges = normalizeMerges(JSON.parse(response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')), stories, shown);
        const all = [...shown, ...stories];
        const byId = new Map(all.map(s => [s.id, s]));
        const maybe = new Set(list.maybe.map(pair => [...pair].sort().join()));
        const isMaybe = (a, b) => maybe.has([a.source, b.source].sort().join());
        stories.forEach((story, i) => {
            const above = all.slice(0, shown.length + i);
            const should = above.some(s => fact[s.source] === fact[story.source]);
            const into = merges.has(story.id) ? byId.get(merges.get(story.id)) : null;
            if (should) total.should++; else total.alone++;
            if (into && fact[into.source] === fact[story.source]) { total.joined++; return; }
            if (into && isMaybe(into, story)) return;
            if (into) {
                total.wrong++;
                if (into.id.startsWith('shown')) total.wrongShown++;
                const key = `joined  ${list.name}: ${story.lead.title.slice(0, 70)}
             into ${into.id.startsWith('shown') ? '(shown) ' : ''}${into.lead.title.slice(0, 70)}`;
                misses.set(key, (misses.get(key) ?? 0) + 1);
            } else if (should) {
                const key = `apart   ${list.name}: ${story.lead.title.slice(0, 70)}`;
                misses.set(key, (misses.get(key) ?? 0) + 1);
            }
        });
    }));
}
const pct = (a, b) => `${(100 * a / b).toFixed(0)}%`;
console.log(`${runs} runs: joined to its fact ${pct(total.joined, total.should)} (${total.joined}/${total.should}), joined to another fact ${pct(total.wrong, total.should + total.alone)} (${total.wrong}, ${total.wrongShown} of them into a shown card: hidden)`);
console.log(`tokens per call: ${Math.round(tokens.input / tokens.calls)} read, ${Math.round(tokens.output / tokens.calls)} written, ${(seconds.reduce((a, b) => a + b, 0) / seconds.length).toFixed(1)} s`);
for (const [key, count] of [...misses].sort((a, b) => b[1] - a[1])) console.log(`  ×${count} ${key}`);
