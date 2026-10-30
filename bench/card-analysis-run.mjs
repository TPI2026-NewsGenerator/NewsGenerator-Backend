// The per-card analysis bench, run by one Ollama cloud model on data/card-analysis/cards.json:
//   node bench/card-analysis-run.mjs triage <model> [run] [think]
//     one call per briefing -> data/card-analysis/triage-<model>-<think>-<run>.json
//   node bench/card-analysis-run.mjs analysis <model> [run] [think]
//     one call per card of data/card-analysis/picked.json -> data/card-analysis/analysis-<model>-<think>-<run>.json
//     picked.json is written by the first analysis run: every card some triage run picked, so every
//     analysis run writes on the same cards
//     BENCH_BRIEFINGS=94,92 only the cards of these briefings (a second run on fewer cards)
//     BENCH_PROMPT=v2 the prompt of round 2 (analysisPromptV2); give it a run name of its own (v2)
//   think: 'none' (the param not sent), 'on' (true), 'off' (false)
// Only Ollama, a client of its own (no Gemini fallback), at most BENCH_CONCURRENCY calls at once (4:
// the key takes 6, the server uses it too). /api/usage is read before and after: what the run cost.
import 'dotenv/config';
import fs from 'node:fs';
import {Ollama} from 'ollama';
import {analysisPrompt, analysisPromptV2, triagePrompt} from './card-analysis-prompt.mjs';

const [step, model, run = '1', thinkArg = 'none'] = process.argv.slice(2);
if (!['triage', 'analysis'].includes(step) || !model) throw new Error('usage: node bench/card-analysis-run.mjs triage|analysis <model> [run] [think]');
const think = thinkArg === 'none' ? undefined : thinkArg === 'on' ? true : thinkArg === 'off' ? false : thinkArg;
const slug = `${model.replace(/[:.]/g, '-')}-${thinkArg}`;
const DIR = new URL('./data/card-analysis/', import.meta.url);
const briefings = JSON.parse(fs.readFileSync(new URL('cards.json', DIR), 'utf8'));
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

// the calls of this run: [{key, briefing, card?, prompt}]
let calls;
if (step === 'triage') {
    calls = briefings.map(b => ({key: `${b.id}`, briefing: b.id, prompt: triagePrompt(b)}));
} else {
    const PICKED = new URL('picked.json', DIR);
    if (!fs.existsSync(PICKED)) {
        const picked = {};
        for (const file of fs.readdirSync(DIR).filter(f => /^triage-.*\.json$/.test(f))) {
            for (const r of JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8')).results) {
                if (r.error) continue;
                const valid = new Set(briefings.find(b => b.id === r.briefing).cards.map(c => c.n));
                for (const pick of Array.isArray(r.json?.cards) ? r.json.cards : []) {
                    const n = Number(pick?.n);
                    if (!valid.has(n)) continue;
                    (picked[r.briefing] ??= new Set()).add(n);
                }
            }
        }
        fs.writeFileSync(PICKED, JSON.stringify(Object.fromEntries(Object.entries(picked).map(([b, s]) => [b, [...s].sort((x, y) => x - y)])), null, 1));
    }
    const picked = JSON.parse(fs.readFileSync(PICKED, 'utf8'));
    const only = process.env.BENCH_ONLY?.split(',');
    // BENCH_BRIEFINGS: a subset of the briefings, written as a normal run (a second run on fewer cards)
    const subset = process.env.BENCH_BRIEFINGS?.split(',').map(Number);
    calls = briefings.filter(b => !subset || subset.includes(b.id)).flatMap(b => (picked[b.id] ?? []).map(n => {
        const card = b.cards[n - 1];
        return {key: `${b.id}-${n}`, briefing: b.id, card: n, prompt: (process.env.BENCH_PROMPT === 'v2' ? analysisPromptV2 : analysisPrompt)(card, b.language)};
    })).filter(c => !only || only.includes(c.key));
}

const before = await readUsage();
const startedAt = Date.now();
const results = await Promise.all(calls.map(async ({prompt, ...call}) => {
    const answer = await ask(prompt);
    console.log(`${call.key}: ${answer.error ? 'ERROR ' + answer.error : `${answer.seconds.toFixed(1)} s, ${answer.input} in, ${answer.output} out, thinking ${answer.thinking} chars`}`);
    return {...call, ...answer};
}));
const wallSeconds = (Date.now() - startedAt) / 1000;
const after = await settledUsage(before, results.length + stats.retries);
const ok = results.filter(r => !r.error);
const sum = (f) => ok.reduce((s, r) => s + f(r), 0);
const summary = {
    step, model, run, think: thinkArg, calls: ok.length, failed: results.length - ok.length, stats,
    wallSeconds: Math.round(wallSeconds),
    secondsPerCall: +(sum(r => r.seconds) / ok.length).toFixed(1),
    maxSeconds: Math.max(...ok.map(r => r.seconds)),
    tokensPerCall: {input: Math.round(sum(r => r.input) / ok.length), output: Math.round(sum(r => r.output) / ok.length)},
    thinkingCharsPerCall: Math.round(sum(r => r.thinking) / ok.length),
    usage: {before, after, usd: +(after.usage_usd - before.usage_usd).toFixed(5), requests: after.request_count - before.request_count,
        input: after.input_tokens - before.input_tokens, output: after.output_tokens - before.output_tokens},
};
summary.usdPerCall = +(summary.usage.usd / results.length).toFixed(5);
const only = process.env.BENCH_ONLY ? '.try' : '';
fs.writeFileSync(new URL(`${step}-${slug}-${run}${only}.json`, DIR), JSON.stringify({summary, results}, null, 1));
console.log(JSON.stringify({...summary, usage: {...summary.usage, before: undefined, after: undefined}}, null, 1));
process.exit(0);
