// An unsaved briefing of a profile (write(null, ...)): the calls Ollama answered busy (429), the ones
// sent to Gemini, the seconds of each step, the cards with angles and official sources. With
// OLLAMA_CONCURRENCY=99 the server's limit is off (see ollama.js).
//   OLLAMA_CONCURRENCY=5 node --env-file=.env bench/briefing-busy.mjs [profile=7] [hours=48]
import process from 'node:process';
import {write} from '../services/briefing-service.js';
import {aiStats} from '../services/utils/ollama.js';

let seconds = '';
const log = console.log;
console.log = (...args) => {
    const line = args.join(' ');
    const found = line.match(/seconds (\{.*\})$/);
    if (line.startsWith('Briefing null: tokens') && found) seconds = found[1];
};
const started = Date.now();
const items = await write(null, Number(process.argv[2] ?? 7), Number(process.argv[3] ?? 48));
console.log = log;
console.log(`limit ${process.env.OLLAMA_CONCURRENCY ?? 6}: ${Math.round((Date.now() - started) / 1000)} s, busy ${aiStats.busy}, gemini ${aiStats.gemini}, `
    + `${items.length} cards, ${items.filter(i => i.angles.length).length} with angles (${items.reduce((n, i) => n + i.angles.length, 0)}), `
    + `${items.filter(i => i.official.length).length} with official, seconds ${seconds}`);
process.exit(0);
