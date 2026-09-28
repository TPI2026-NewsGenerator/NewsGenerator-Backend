//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: ollama.js
//  Description: Ollama import
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
const ollama = new Ollama({
    host: process.env.OLLAMA_HOST || 'https://ollama.com',
    headers: process.env.OLLAMA_API_KEY ? {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY} : {},
})

// The tokens of the calls, added to 'usage' when one is given: {calls, input, output}. 'output'
// counts the reasoning of the model too, it is paid as any other token.
export const newUsage = () => ({calls: 0, input: 0, output: 0});
const count = (usage, response) => {
    if (!usage) return;
    usage.calls += 1;
    usage.input += response.prompt_eval_count ?? 0;
    usage.output += response.eval_count ?? 0;
};

// returns the resume of a news, always about the same length, and its topic
// one call gives both: the AI reads the article once. 'language' is the one the resume is written in
// an answer of the AI as JSON, for the calls that return data rather than text (the interests of a
// profile, the stories of a briefing). format: 'json' is asked, but the model sometimes still wraps
// its answer in a markdown json block, so that is removed before reading it. A conversation can be
// given for the prompt, to ask again after an answer
export const ollamaJson = async (prompt, usage = null, {think} = {}) => {
    const response = await ollama.chat({
        model: MODEL,
        format: 'json',
        messages: Array.isArray(prompt) ? prompt : [{role: 'user', content: prompt}],
        ...(think ? {think} : {}),
        options: {temperature: 0.1},
    });
    count(usage, response);

    const raw = response.message.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
    try {
        return JSON.parse(raw);
    } catch {
        throw Object.assign(new Error('The AI did not answer in JSON.'), {status: 502});
    }
};
