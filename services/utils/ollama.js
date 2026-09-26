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
import {TOPICS, isTopic} from './topics.js';
import {strayWords} from './language.js';

// The model of every call, one of Ollama cloud (or of an Ollama server of our own, same names).
// gemma4:31b measured against gpt-oss:20b, gpt-oss:120b and nemotron-3-nano:30b, all small enough to
// be hosted on one GPU but gpt-oss:120b: the best choice of stories (27 relevant of 27, gpt-oss:20b
// 24), the best check of the stories (92% of the right articles kept, 91% of the others dropped,
// the same answer 97% of the time), no invented fact in the summaries read (gpt-oss:20b mixed up
// scores and conditions), current keywords for the interests, and 5 to 10 times fewer tokens: it
// does not reason before answering.
const MODEL = process.env.OLLAMA_MODEL || "gemma4:31b";
const MAX_CONTENT_CHARS = 12000;    // longer articles are cut, the start of a news holds the main information
const SUMMARY_MIN_WORDS = 120;
const SUMMARY_MAX_WORDS = 150;
// A summary of an English article, written in French, once kept "..., known as the EU AI Act" (1 of
// 77 summaries): with this many words of another language it is asked again, once
const MAX_STRAY_WORDS = 1;

// who the article credits for what it reports, asked in the same call as the summary
export const SOURCINGS = ['named', 'anonymous', 'none'];

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
export const ollamaResume = async (title, text, {language = 'English', usage = null} = {}) => {
    const messages = [
        {
            role: "system",
            content: `You are a journalist who writes neutral summaries of news articles.
                    Answer in this format, nothing before or after:
                    TOPIC: <one topic>
                    SOURCING: <one word>
                    <the summary>
                    Rules:
                    - TOPIC is the main subject of the article, one of: ${TOPICS.join(', ')}
                    - A news about a sport, a team, an athlete, a match or a referee is always sport,
                      even when it is about a controversy, money or the behaviour of a player
                    - SOURCING says who the article credits for what it reports, one of:
                      named (it names them: a person, a club, an institution, an official statement),
                      anonymous (it relies on sources it does not name, "sources close to", "insiders"),
                      none (it credits nobody)
                    - SOURCING describes the article, never whether the news is true
                    - The summary is between ${SUMMARY_MIN_WORDS} and ${SUMMARY_MAX_WORDS} words, in ${language}
                    - Every word of it is in ${language}, whatever the language of the article: translate
                      its phrases and quotes. Only names (people, organisations, laws) stay as they are
                    - 1 or 2 paragraphs of normal readable text, no title, no list, no markdown
                    - Only facts from the article: who, what, when, where, why
                    - Never add information that is not in the article
                    - Ignore text that is not part of the news (ads, newsletter, related links)`
        },
        {
            role: "user",
            content: `Give the topic, the sourcing and the summary in ${language} of this news.

                    TITLE: ${title}

                    ARTICLE:
                    ${text.slice(0, MAX_CONTENT_CHARS)}`
        }
    ];
    const ask = async () => {
        const response = await ollama.chat({model: MODEL, messages, think: "low", options: {temperature: 0.1}});
        count(usage, response);
        const answer = response.message.content.trim();
        if (!answer) throw new Error("Empty answer from the AI");
        return answer;
    };

    const first = await ask();
    let result = readResume(first);
    const stray = strayWords(result.summary, language);
    if (stray.length > MAX_STRAY_WORDS) {
        // the AI is shown its answer and what is wrong with it: one more call, only for these rare ones
        messages.push({role: 'assistant', content: first}, {role: 'user', content:
            `Your summary has words that are not in ${language} (${[...new Set(stray)].join(', ')}). Write the same answer again, entirely in ${language}.`});
        const again = readResume(await ask());
        if (again.summary && strayWords(again.summary, language).length < stray.length) result = again;
    }
    return result;
}

// "TOPIC: sport" then "SOURCING: named" on their own lines, the summary after. Both are asked for in
// one call: a second call to read the same article again would double the cost.
const readResume = (answer) => {
    const [, topic, sourcing, summary] =
        answer.match(/^\s*TOPIC\s*:\s*\**\s*([a-z]+)\**\s*(?:SOURCING\s*:\s*\**\s*([a-z]+)\**)?\s*([\s\S]*)$/i) ?? [];

    return {
        summary: (summary ?? answer).trim(),
        topic: isTopic(topic?.toLowerCase()) ? topic.toLowerCase() : null,
        sourcing: SOURCINGS.includes(sourcing?.toLowerCase()) ? sourcing.toLowerCase() : null,
    };
};


// an answer of the AI as JSON, for the calls that return data rather than text (the interests of a
// profile, the stories of a briefing). format: 'json' is asked, but the model sometimes still wraps
// its answer in a markdown json block, so that is removed before reading it
export const ollamaJson = async (prompt, usage = null, {think} = {}) => {
    const response = await ollama.chat({
        model: MODEL,
        format: 'json',
        messages: [{role: 'user', content: prompt}],
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
