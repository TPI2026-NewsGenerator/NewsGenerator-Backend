// the interests written by several models for the profiles of the test accounts, and the words of each
// profile no interest names: node bench/profile-models.mjs <model,model> <username...>
import 'dotenv/config';
import pg from 'pg';
import {Ollama} from 'ollama';
import {interestsPrompt, missingWords, normalizeInterests} from '../services/utils/profile-ai.js';
import {FeedService} from '../services/feed-service.js';

// a call of Ollama cloud can stay unanswered for good (25 minutes on 13.10.2026): each request is given
// up after 120 s, an error as any other
const ollama = new Ollama({host: 'https://ollama.com', headers: {Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`},
    fetch: (url, init) => fetch(url, {...init, signal: AbortSignal.timeout(120e3)})});
const [models, ...usernames] = process.argv.slice(2);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const categories = FeedService.categories();

const texts = usernames[0]?.endsWith(".json") ? JSON.parse((await import("node:fs")).readFileSync(usernames[0], "utf8")) : null;
for (const username of texts ?? usernames) {
    const {rows: [u]} = texts ? {rows: [username]} : await client.query(`SELECT up.text, up.languages, up.topics FROM users u JOIN user_profiles up ON up.id_user = u.id WHERE u.username = $1`, [username]);
    const profile = {text: u.text, topics: u.topics ?? [], languages: u.languages, categories};
    console.log(`\n==== ${username}`);
    for (const spec of models.split(',')) {
        const [model, think] = spec.split('+');
        const started = Date.now();
        try {
            const response = await ollama.chat({model, format: 'json', messages: [{role: 'user', content: interestsPrompt(profile)}],
                ...(think ? {think} : {}), options: {temperature: 0.1}});
            const answer = JSON.parse(response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
            const interests = normalizeInterests(answer, profile);
            const missing = missingWords(profile.text, interests, answer?.refused);
            console.log(`-- ${spec}: ${Math.round((Date.now() - started) / 1000)} s, ${response.prompt_eval_count}+${response.eval_count} tokens, missing: ${missing.join(', ') || '-'}`);
            console.log(`   refused: ${JSON.stringify(answer?.refused ?? null)}`);
            interests.forEach(i => console.log(`   w${i.weight} ${i.text}\n      kw: ${i.keywords}`));
        } catch (err) {
            console.log(`-- ${spec}: ${err.message}`);
        }
    }
}
await client.end();
