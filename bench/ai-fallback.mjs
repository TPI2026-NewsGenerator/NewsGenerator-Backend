// The Gemini API answering when Ollama fails: Ollama pointed to an address where nothing answers.
// OLLAMA_HOST=http://127.0.0.1:9 node --env-file=.env bench/ai-fallback.mjs
import {newUsage, ollamaJson} from '../services/utils/ollama.js';

const usage = newUsage();
const started = Date.now();
const answer = await ollamaJson('Réponds uniquement en JSON : {"capitale": "..."} pour la Suisse.', usage);
console.log(JSON.stringify(answer), `${((Date.now() - started) / 1000).toFixed(1)} s`, JSON.stringify(usage));
