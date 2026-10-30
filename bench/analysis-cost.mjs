// What one analysis costs per model, measured alone: node bench/analysis-cost.mjs <model> <think> [briefing ids]
//   The usage windows of analysis-run.mjs count the other processes on the key too (the server, other
//   benches). Here one call at a time, the usage read before and after it until the call is counted;
//   a window with any other request in it is thrown away and the call asked again (3 tries).
//   Appends {model, think, id, input, output, usd, clean} to data/analysis/cost.json.
import 'dotenv/config';
import fs from 'node:fs';
import {Ollama} from 'ollama';
import {analysisPrompt} from './analysis-prompt.mjs';

const [model, thinkArg = 'none', ids = '94,92'] = process.argv.slice(2);
const think = thinkArg === 'none' ? undefined : thinkArg === 'on' ? true : thinkArg === 'off' ? false : thinkArg;
const headers = {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY};
const briefings = JSON.parse(fs.readFileSync(new URL('./data/analysis/briefings.json', import.meta.url), 'utf8'));
const ollama = new Ollama({host: 'https://ollama.com', headers});
const readUsage = async () => (await (await fetch('https://ollama.com/api/usage', {headers})).json()).totals;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const FILE = new URL('./data/analysis/cost.json', import.meta.url);
const out = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];

for (const id of ids.split(',').map(Number)) {
    const b = briefings.find(x => x.id === id);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const before = await readUsage();
        const r = await ollama.chat({model, format: 'json', messages: [{role: 'user', content: analysisPrompt(b)}],
            ...(think === undefined ? {} : {think}), options: {temperature: 0.1}});
        let after = await readUsage();
        for (let i = 0; i < 16 && after.request_count < before.request_count + 1; i++) {
            await sleep(15e3);
            after = await readUsage();
        }
        await sleep(15e3);
        after = await readUsage();
        const row = {model, think: thinkArg, id, attempt, input: r.prompt_eval_count, output: r.eval_count,
            requests: after.request_count - before.request_count, usd: +(after.usage_usd - before.usage_usd).toFixed(6),
            meteredInput: after.input_tokens - before.input_tokens, meteredOutput: after.output_tokens - before.output_tokens,
            cached: after.cached_input_tokens - before.cached_input_tokens};
        row.clean = row.requests === 1;
        console.log(JSON.stringify(row));
        out.push(row);
        fs.writeFileSync(FILE, JSON.stringify(out, null, 1));
        if (row.clean) break;
    }
}
