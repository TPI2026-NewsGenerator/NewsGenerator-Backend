// the interests of the 7 profiles of the bench with the prompt of today and with a rule added, several
// runs each: how many interests, which, and the words left out
// node bench/split-rule.mjs [runs] [rule file]
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {Ollama} from 'ollama';
import {interestsPrompt, missingWords, normalizeInterests} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';

const runs = Number(process.argv[2] ?? 3);
const rule = fs.readFileSync(process.argv[3] ?? new URL('./split-rule.txt', import.meta.url), 'utf8').trim();
const ANCHOR = `n'est pas un intérêt : ne le mets dans aucun intérêt, mets-le dans "refused".`;
// a call of Ollama cloud can stay unanswered for good (25 minutes on 13.10.2026): each request is given
// up after 120 s, an error as any other
const ollama = new Ollama({host: 'https://ollama.com', headers: {Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`},
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(120e3)})});
const categories = FeedService.categories();

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT u.username AS name, up.text, up.languages, up.topics FROM users u JOIN user_profiles up ON up.id_user = u.id ORDER BY u.id`);
await client.end();
const profiles = [...rows, ...JSON.parse(fs.readFileSync(new URL('./profile-texts.json', import.meta.url), 'utf8'))].filter(p => !process.env.ONLY || p.name === process.env.ONLY);

const ask = async (prompt) => {
    const response = await ollama.chat({model: process.env.OLLAMA_MODEL ?? 'gemma4:31b', format: 'json', ...(process.env.OLLAMA_THINK ? {think: ({true: true, false: false})[process.env.OLLAMA_THINK] ?? process.env.OLLAMA_THINK} : {}),  messages: [{role: 'user', content: prompt}], options: {temperature: 0.1}});
    return JSON.parse(response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
};

for (const row of profiles) {
    const profile = {text: row.text, topics: row.topics ?? [], languages: row.languages, categories};
    const today = interestsPrompt(profile);
    if (!today.includes(ANCHOR)) throw new Error('the anchor of the rule is not in the prompt');
    console.log(`\n==== ${row.name}`);
    for (const [variant, prompt] of [['today', today], ['rule', today.replace(ANCHOR, `${ANCHOR}\n${rule}`)]].slice(0, process.env.TODAY_ONLY ? 1 : 2)) {
        const seen = new Map();
        for (let run = 0; run < runs; run++) {
            const answer = await ask(prompt).catch(err => ({error: err.message}));
            const interests = normalizeInterests(answer, profile);
            const missing = missingWords(profile.text, interests, answer?.refused);
            const key = interests.map(interest => interest.text).join('\n      ');
            seen.set(key, {count: (seen.get(key)?.count ?? 0) + 1, n: interests.length, missing});
        }
        for (const [key, {count, n, missing}] of seen) {
            console.log(`-- ${variant} ×${count}: ${n} interests${missing.length ? `, missing: ${missing.join(', ')}` : ''}\n      ${key}`);
        }
    }
}
