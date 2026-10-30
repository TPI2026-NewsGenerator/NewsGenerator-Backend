// Read only: how many calls Ollama cloud takes at once before its 429 "too many concurrent requests",
// N calls of a short prompt sent together, no retry, no Gemini. Each line: N, answered, 429, other
// errors, the seconds of the slowest. node --env-file=.env bench/ollama-concurrency.mjs [2,4,6,8,10,12]
import process from 'node:process';
import {Ollama} from 'ollama';

const ollama = new Ollama({host: process.env.OLLAMA_HOST || 'https://ollama.com',
    headers: process.env.OLLAMA_API_KEY ? {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY} : {}});
const prompt = (i) => `A news card: "UEFA president Ceferin to run for a final term (${i})". Answer in JSON only: {"topic": "a word"}`;
for (const n of (process.argv[2] ?? '2,4,6,8,10,12').split(',').map(Number)) {
    const started = Date.now();
    const results = await Promise.allSettled(Array.from({length: n}, (_, i) => ollama.chat({
        model: process.env.OLLAMA_MODEL || 'gemma4:31b', format: 'json', options: {temperature: 0.1},
        messages: [{role: 'user', content: prompt(i)}]}).then(() => (Date.now() - started) / 1e3)));
    const busy = results.filter(r => r.status === 'rejected' && r.reason?.status_code === 429).length;
    const other = results.filter(r => r.status === 'rejected' && r.reason?.status_code !== 429);
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    console.log(`${n} at once: ${ok.length} answered, ${busy} busy (429), ${other.length} other ${other.map(r => r.reason?.message).join('; ')}, slowest ${Math.max(0, ...ok).toFixed(1)} s`);
    await new Promise(resolve => setTimeout(resolve, 5e3));
}
