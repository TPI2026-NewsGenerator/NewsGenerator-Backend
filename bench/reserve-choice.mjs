// How many stories the AI chooses for a briefing, and so how many are left for the reserve (the
// stories that replace a card that can't be read, see readable-cards.js): the prompt of the choice
// of each reader taken from a briefing stopped right after it (the AI is answered "nothing chosen"
// there, so nothing else is read or asked), then asked as it is and as a variant, 'runs' times each.
// Writes the choices with their titles, to judge the ones beyond the briefing. Read only.
//   node --env-file=.env bench/reserve-choice.mjs <out.json> <hours> <runs> <variant.mjs> userId...
// variant.mjs: export default (prompt) => the prompt of the variant
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const [out, hoursArg, runsArg, variantPath, ...userArgs] = process.argv.slice(2);
const hours = Number(hoursArg);
const runs = Number(runsArg);
const variant = (await import(pathToFileURL(resolve(variantPath)).href)).default;

// the call of the choice answered "nothing chosen" while a briefing is stopped, its prompt kept
let stopping = false;
let captured = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
    if (!stopping || !/ollama\.com/.test(String(url?.url ?? url))) return realFetch(url, options);
    captured = JSON.parse(options.body).messages[0].content;
    return new Response(JSON.stringify({model: 'stub', message: {role: 'assistant', content: '{"selected": []}'}, done: true,
        prompt_eval_count: 0, eval_count: 0}), {status: 200, headers: {'Content-Type': 'application/json'}});
};

const {write} = await import('../services/briefing-service.js');
const {BriefingModel} = await import('../models/briefing-model.js');
const {DiscoveryService} = await import('../services/discovery-service.js');
const {ollamaJson, newUsage} = await import('../services/utils/ollama.js');
const {normalizeSelection, MAX_BRIEFING} = await import('../services/utils/profile-ai.js');
BriefingModel.step = async () => {};
DiscoveryService.prune = async () => {};

const result = [];
const log = console.log;
for (const userId of userArgs.map(Number)) {
    stopping = true;
    captured = null;
    console.log = () => {};
    await write(null, userId, hours).catch(err => log(`user ${userId}: ${err.message}`));
    console.log = log;
    stopping = false;
    if (!captured) continue;

    // the candidates as the prompt lists them: "[id] title — description"
    const titles = new Map([...captured.matchAll(/^\[(\d+)\] (.*)$/gm)].map(([, id, line]) => [id, line.split(' — ')[0]]));
    const ask = async (prompt) => {
        const usage = newUsage();
        const started = Date.now();
        const chosen = normalizeSelection(await ollamaJson(prompt, usage), [...titles.keys()]);
        return {seconds: (Date.now() - started) / 1000, input: usage.input, output: usage.output,
            chosen: chosen.map(item => ({id: item.id, title: titles.get(item.id), why: item.why}))};
    };
    const entry = {userId, candidates: titles.size, prompt: captured, current: [], variant: []};
    for (let run = 0; run < runs; run++) {
        entry.current.push(await ask(captured));
        entry.variant.push(await ask(variant(captured)));
    }
    const counts = (list) => list.map(r => r.chosen.length).join(', ');
    log(`user ${userId}: ${titles.size} candidates, chosen now ${counts(entry.current)}, with the variant ${counts(entry.variant)} (briefing ${MAX_BRIEFING})`);
    result.push(entry);
    writeFileSync(out, JSON.stringify(result, null, 1));
}
process.exit(0);
