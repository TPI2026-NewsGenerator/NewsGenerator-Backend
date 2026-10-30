// The analysis of each briefing of data/analysis/briefings.json written by one Ollama cloud model:
//   node bench/analysis-run.mjs <model> [run] [think]
//   writes data/analysis/run-<model>-<think>-<run>.json (':' and '.' of the tag become '-')
//   think: 'none' (the param not sent, as production sends it for gemma4:31b), 'on' (true), 'off'
//   (false) or a level ('low')
// Only Ollama: a client of its own (no Gemini fallback, it would answer with gemma), at most
// BENCH_CONCURRENCY calls at once (4: Ollama takes 6 for the whole key, the server uses it too). The
// usage of the key (/api/usage) is read before and after, to tell what the model cost.
import 'dotenv/config';
import fs from 'node:fs';
import {Ollama} from 'ollama';
import {analysisPrompt} from './analysis-prompt.mjs';

const [model, run = '1', thinkArg = 'none'] = process.argv.slice(2);
if (!model) throw new Error('usage: node bench/analysis-run.mjs <model> [run] [think]');
const think = thinkArg === 'none' ? undefined : thinkArg === 'on' ? true : thinkArg === 'off' ? false : thinkArg;
const slug = `${model.replace(/[:.]/g, '-')}-${thinkArg}`;
const only = process.env.BENCH_ONLY?.split(',').map(Number);
const briefings = JSON.parse(fs.readFileSync(new URL('./data/analysis/briefings.json', import.meta.url), 'utf8'))
    .filter(b => !only || only.includes(b.id));
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 4;
const BUSY_WAITS_MS = [2e3, 5e3, 10e3, 20e3, 30e3];
const TIMEOUT_MS = 300e3;
const headers = {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY};

let running = 0;
const waiting = [];
const inTurn = async (task) => {
    if (running >= CONCURRENCY) await new Promise(resolve => waiting.push(resolve));
    else running++;
    try {
        return await task();
    } finally {
        const next = waiting.shift();
        if (next) next(); else running--;
    }
};

const stats = {busy: 0, retries: 0, failed: 0, noJson: 0};
const askOnce = async (prompt) => inTurn(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`no answer in ${TIMEOUT_MS / 1e3} s`)), TIMEOUT_MS);
    const ollama = new Ollama({host: 'https://ollama.com', headers, fetch: (url, init) => fetch(url, {...init, signal: controller.signal})});
    const start = Date.now();
    try {
        const response = await ollama.chat({
            model,
            format: 'json',
            messages: [{role: 'user', content: prompt}],
            ...(think === undefined ? {} : {think}),
            options: {temperature: 0.1},
        });
        const raw = response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
        return {raw, input: response.prompt_eval_count ?? 0, output: response.eval_count ?? 0,
            thinking: (response.message.thinking ?? '').length, seconds: (Date.now() - start) / 1000};
    } finally {
        clearTimeout(timer);
    }
});
const isBusy = (err) => err.status_code === 429 && /concurren/i.test(err.message ?? '');
const ask = async (prompt) => {
    let busy = 0;
    for (let attempt = 0; attempt < 3;) {
        try {
            const answer = await askOnce(prompt);
            try {
                return {...answer, json: JSON.parse(answer.raw)};
            } catch {
                stats.noJson++;
                throw new Error(`no JSON: ${answer.raw.slice(0, 160)}`);
            }
        } catch (err) {
            if (isBusy(err) && busy < BUSY_WAITS_MS.length) {
                stats.busy++;
                await new Promise(resolve => setTimeout(resolve, BUSY_WAITS_MS[busy++]));
                continue;
            }
            attempt++;
            stats.retries++;
            if (attempt >= 3) {
                stats.failed++;
                console.error(`${model}: failed ${err.status_code ?? ''} ${err.message}`);
                return {error: String(err.message)};
            }
        }
    }
    return {error: 'busy'};
};

const readUsage = async () => {
    const response = await fetch('https://ollama.com/api/usage', {headers});
    const body = await response.json();
    return {at: new Date().toISOString(), ...body.totals};
};
// the usage counts a call some seconds after its answer: read again until 'calls' more requests are
// counted (other processes on the key count too) and the count stays the same 15 s, 4 min max
const settledUsage = async (from, calls) => {
    let last = await readUsage();
    for (const end = Date.now() + 240e3; Date.now() < end;) {
        await new Promise(resolve => setTimeout(resolve, 15e3));
        const now = await readUsage();
        if (now.request_count >= from.request_count + calls && now.request_count === last.request_count) return now;
        last = now;
    }
    return {...last, unsettled: true};
};

const before = await readUsage();
const startedAt = Date.now();
const results = await Promise.all(briefings.map(async (b) => {
    const answer = await ask(analysisPrompt(b));
    console.log(`${b.id}: ${answer.error ? 'ERROR ' + answer.error : `${answer.seconds.toFixed(1)} s, ${answer.input} in, ${answer.output} out, thinking ${answer.thinking} chars`}`);
    return {id: b.id, ...answer};
}));
const wallSeconds = (Date.now() - startedAt) / 1000;
const calls = results.length + stats.retries;
const after = await settledUsage(before, calls);
const ok = results.filter(r => !r.error);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const summary = {
    model, run, think: thinkArg, briefings: ok.length, failed: results.length - ok.length, stats,
    wallSeconds: Math.round(wallSeconds),
    secondsPerBriefing: +(sum(r => r.seconds) / ok.length).toFixed(1),
    maxSeconds: Math.max(...ok.map(r => r.seconds)),
    tokensPerBriefing: {input: Math.round(sum(r => r.input) / ok.length), output: Math.round(sum(r => r.output) / ok.length)},
    thinkingCharsPerBriefing: Math.round(sum(r => r.thinking) / ok.length),
    usage: {before, after, usd: +(after.usage_usd - before.usage_usd).toFixed(5), requests: after.request_count - before.request_count,
        input: after.input_tokens - before.input_tokens, output: after.output_tokens - before.output_tokens},
};
summary.usdPerBriefing = +(summary.usage.usd / results.length).toFixed(5);
fs.writeFileSync(new URL(`./data/analysis/run-${slug}-${run}${only ? '.try' : ''}.json`, import.meta.url), JSON.stringify({summary, results}, null, 1));
console.log(JSON.stringify({...summary, usage: {...summary.usage, before: undefined, after: undefined}}, null, 1));
process.exit(0);
