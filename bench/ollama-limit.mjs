// Read only: the 47 prompts of other angles of bench/data/angles-places.json sent together, as the step
// 'angles' of a briefing does, with the server's limit of OLLAMA_CONCURRENCY calls at once (99 = off,
// then Ollama refuses the 7th and the next ones are asked again after 2, 5, 10 s). Seconds of the whole,
// calls refused, sent to Gemini, failed.
//   OLLAMA_CONCURRENCY=6 node --env-file=.env bench/ollama-limit.mjs
import fs from 'node:fs';
import process from 'node:process';
import {anglesPrompt} from '../services/utils/other-angles.js';
import {aiStats, ollamaJson} from '../services/utils/ollama.js';

const cards = JSON.parse(fs.readFileSync(new URL('./data/angles-places.json', import.meta.url), 'utf8')).flatMap(briefing => briefing.cards)
    .filter(card => card.others.length > 0);
const started = Date.now();
const results = await Promise.allSettled(cards.map(card => ollamaJson(anglesPrompt(card.title, card.others, card.titles ?? [], card.at))));
console.log(`limit ${process.env.OLLAMA_CONCURRENCY ?? 6}: ${cards.length} calls in ${Math.round((Date.now() - started) / 1000)} s, `
    + `refused ${aiStats.busy}, gemini ${aiStats.gemini}, failed ${results.filter(r => r.status === 'rejected').length}`);
process.exit(0);
