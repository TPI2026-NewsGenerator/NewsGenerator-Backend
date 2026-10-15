//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: ollama.js
//  Description: Ollama import, and the Gemini API taking its place when it fails
//

"use strict"

import process from 'node:process'
import 'dotenv/config';
import {Ollama} from 'ollama'

// The model of every call, one of Ollama cloud (or of an Ollama server of our own, same names).
// gemma4:31b measured against gpt-oss:20b, gpt-oss:120b and nemotron-3-nano:30b, all small enough to
// be hosted on one GPU but gpt-oss:120b: the best choice of stories (27 relevant of 27, gpt-oss:20b
// 24), the best check of the stories (92% of the right articles kept, 91% of the others dropped,
// the same answer 97% of the time), no invented fact in the summaries read (gpt-oss:20b mixed up
// scores and conditions), current keywords for the interests, and 5 to 10 times fewer tokens: it
// does not reason before answering.
const MODEL = process.env.OLLAMA_MODEL || "gemma4:31b";
// inspired by "https://github.com/ollama/ollama-js". Ollama cloud by default; OLLAMA_HOST names an
// Ollama server of our own instead (it needs no key)
const OLLAMA_CONFIG = {
    host: process.env.OLLAMA_HOST || 'https://ollama.com',
    headers: process.env.OLLAMA_API_KEY ? {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY} : {},
};
// A call of Ollama cloud can stay unanswered for good: on 13.10.2026 one waited 25 minutes while a
// new one answered in 3.5 s, and a briefing awaiting it stays 'running' forever. It is given up after
// this long, far over the 1 to 7 s it takes, and goes to Gemini as any other failure. ollama-js
// (0.6.3) takes no signal for a call that is not streamed, and its abort() only stops the streamed
// ones: each call gets a client of its own, whose fetch carries the signal, to close the request too
const OLLAMA_TIMEOUT_MS = 120e3;

// The same model on the Gemini API (Google AI Studio), free, when Ollama fails: its quota used up, a
// key refused, the service down. Only then: measured on 8 calls, 30 to 86 s each where Ollama
// answers in 1 to 7, and 2 of them an immediate error 500, asked again once. The free tier lets
// Google read the prompts. No key, no fallback
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 180e3;
// Ollama refusing for its quota or its key refuses the next calls too: they go to Gemini at once for
// this long, then Ollama is asked again
const OLLAMA_PAUSE_MS = 15 * 60e3;
let ollamaPausedUntil = 0;
// Its 429 "too many concurrent requests" is no quota: the calls over the plan's are queued, this one
// found the queue full and a place frees itself in seconds. Taken for the quota, it sent every call
// of the next 15 minutes to Gemini (a briefing of 30 cards on 8.10.2026: its passages in 374 s
// instead of about 30). Ollama is asked again after a wait instead, Gemini only after the last one
const BUSY_WAITS_MS = [2e3, 5e3, 10e3];
// a call of its own model has no Gemini after them: it waits longer for a place (another process of the
// key, a bench, can hold them for a minute), failing only gives up what it was for
const OWN_MODEL_WAITS_MS = [...BUSY_WAITS_MS, 20e3, 30e3];
const isBusy = (err) => err.status_code === 429 && /concurren/i.test(err.message ?? '');

// Ollama cloud takes 6 calls at once and refuses the next ones at once (bench/ollama-concurrency.mjs,
// 14.10.2026: 8 sent together, 2 refused; 12, 6 refused). The step 'angles' of a briefing sends the
// angles (5 at a time), the official sources (3), the statements (3) and translations together, and
// lost the angles of a card to it that day. The calls of the whole server wait for one of these places
// instead. The 47 prompts of angles of bench/ollama-limit.mjs sent together, 3 times each: without it
// 26 to 30 lost (refused 3 times, then Gemini failing too); at most 5 at once none lost, 81-150 s; 6,
// none, 75-102 s. Another process with the same key (a bench of the laptop) is still asked again
const OLLAMA_CONCURRENCY = Number(process.env.OLLAMA_CONCURRENCY) || 6;
let running = 0;
const waiting = [];
const inTurn = async (task) => {
    if (running >= OLLAMA_CONCURRENCY) await new Promise(resolve => waiting.push(resolve));
    else running++;
    try {
        return await task();
    } finally {
        // the place goes straight to the next one waiting, or is freed
        const next = waiting.shift();
        if (next) next(); else running--;
    }
};

// what Ollama answered busy and sent to Gemini since the server started, for the benches and the logs
export const aiStats = {busy: 0, gemini: 0};

// The tokens of the calls, added to 'usage' when one is given: {calls, input, output}. 'output'
// counts the reasoning of the model too, it is paid as any other token.
export const newUsage = () => ({calls: 0, input: 0, output: 0});
const count = (usage, input, output) => {
    if (!usage) return;
    usage.calls += 1;
    usage.input += input ?? 0;
    usage.output += output ?? 0;
};

const askOllama = async (messages, usage, think, model = MODEL) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Object.assign(
        new Error(`Ollama: no answer in ${OLLAMA_TIMEOUT_MS / 1e3} s`), {status: 502})), OLLAMA_TIMEOUT_MS);
    const ollama = new Ollama({...OLLAMA_CONFIG, fetch: (url, init) => fetch(url, {...init, signal: controller.signal})});
    // the race ends the wait even if the abort is not heard (the response read, a client mocked)
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason)));
    try {
        const response = await Promise.race([aborted, ollama.chat({
            model,
            format: 'json',
            messages,
            // false is sent too: a model that reasons by default (deepseek-v4-pro) does it otherwise
            ...(think !== undefined ? {think} : {}),
            options: {temperature: 0.1},
        })]);
        count(usage, response.prompt_eval_count, response.eval_count);
        return response.message.content;
    } finally {
        clearTimeout(timer);
    }
};

// format: 'json' of the API answers an error 500 for this model: the prompts ask for JSON already.
// Its reasoning is kept minimal unless the call asks for it, the reasoning comes in parts of its own
const askGemini = async (messages, usage, think) => {
    const call = () => fetch(GEMINI_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': process.env.AISTUDIO_API_KEY},
        body: JSON.stringify({
            contents: messages.map(({role, content}) => ({role: role === 'assistant' ? 'model' : 'user', parts: [{text: content}]})),
            generationConfig: {temperature: 0.1, ...(think ? {} : {thinkingConfig: {thinkingLevel: 'minimal'}})},
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    let response = await call();
    if (response.status >= 500) response = await call();
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Gemini: ${body.error?.message ?? `HTTP ${response.status}`}`), {status: 502});

    const {promptTokenCount, candidatesTokenCount, thoughtsTokenCount} = body.usageMetadata ?? {};
    count(usage, promptTokenCount, (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0));
    return (body.candidates?.[0]?.content?.parts ?? []).filter(part => !part.thought).map(part => part.text ?? '').join('');
};

// Ollama first, Gemini when it fails and a key is given. An answer of Ollama that is no JSON is no
// failure of Ollama: the caller asks again. A call naming its own model never goes to Gemini, which
// would answer with gemma: it fails instead, and its caller keeps what it has without it
const ask = async (messages, usage, think, model) => {
    const gemini = Boolean(process.env.AISTUDIO_API_KEY) && !model;
    if (gemini && Date.now() < ollamaPausedUntil) return askGemini(messages, usage, think);
    for (let attempt = 0; ; attempt++) {
        try {
            return await inTurn(() => askOllama(messages, usage, think, model));
        } catch (err) {
            if (isBusy(err)) aiStats.busy++;
            const waits = model ? OWN_MODEL_WAITS_MS : BUSY_WAITS_MS;
            if (isBusy(err) && attempt < waits.length) {
                await new Promise(resolve => setTimeout(resolve, waits[attempt]));
                continue;
            }
            if (!gemini) throw err;
            // 401, 403: the key, 429: the quota. Else a call that failed alone (5xx, network), or
            // Ollama still busy
            if ([401, 403, 429].includes(err.status_code) && !isBusy(err)) ollamaPausedUntil = Date.now() + OLLAMA_PAUSE_MS;
            aiStats.gemini++;
            console.error(`AI: Ollama failed (${err.status_code ?? ''} ${err.message}), Gemini asked`);
            return askGemini(messages, usage, think);
        }
    }
};

// an answer of the AI as JSON, for the calls that return data rather than text (the interests of a
// profile, the stories of a briefing). format: 'json' is asked, but the model sometimes still wraps
// its answer in a markdown json block, so that is removed before reading it. A conversation can be
// given for the prompt, to ask again after an answer. model: another model of Ollama for this call
// (see ai-ways.js), never answered by Gemini
export const ollamaJson = async (prompt, usage = null, {think, model} = {}) => {
    const content = await ask(Array.isArray(prompt) ? prompt : [{role: 'user', content: prompt}], usage, think, model);

    const raw = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
    try {
        return JSON.parse(raw);
    } catch {
        // its start and its end say why: an answer cut, a text before the JSON, a JSON badly written
        console.error(`AI: no JSON in an answer of ${raw.length} characters: ${JSON.stringify(raw.slice(0, 200))} ... ${JSON.stringify(raw.slice(-200))}`);
        throw Object.assign(new Error('The AI did not answer in JSON.'), {status: 502});
    }
};
