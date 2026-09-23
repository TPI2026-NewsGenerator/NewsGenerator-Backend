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

const MODEL = "gpt-oss:20b";
const MAX_CONTENT_CHARS = 12000;    // longer articles are cut, the start of a news holds the main information
const SUMMARY_MIN_WORDS = 120;
const SUMMARY_MAX_WORDS = 150;

// who the article credits for what it reports, asked in the same call as the summary
export const SOURCINGS = ['named', 'anonymous', 'none'];

// inspired by "https://github.com/ollama/ollama-js"
const ollama = new Ollama({
    host: 'https://ollama.com',
    headers: {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY},
})

// returns the resume of a news, always about the same length, and its topic
// one call gives both: the AI reads the article once
export const ollamaResume = async (title, text) => {
    const response = await ollama.chat({
        model: MODEL,
        messages: [
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
                        - The summary is between ${SUMMARY_MIN_WORDS} and ${SUMMARY_MAX_WORDS} words, in English
                        - 1 or 2 paragraphs of normal readable text, no title, no list, no markdown
                        - Only facts from the article: who, what, when, where, why
                        - Never add information that is not in the article
                        - Ignore text that is not part of the news (ads, newsletter, related links)`
            },
            {
                role: "user",
                content: `Give the topic, the sourcing and the summary of this news.

                        TITLE: ${title}

                        ARTICLE:
                        ${text.slice(0, MAX_CONTENT_CHARS)}`
            }
        ],
        think: "low",
        options: {
            temperature: 0.1
        }
    });

    const answer = response.message.content.trim();
    if (!answer) throw new Error("Empty answer from the AI");

    // "TOPIC: sport" then "SOURCING: named" on their own lines, the summary after. Both are asked
    // for in this one call: a second call to read the same article again would double the cost.
    const [, topic, sourcing, summary] =
        answer.match(/^\s*TOPIC\s*:\s*\**\s*([a-z]+)\**\s*(?:SOURCING\s*:\s*\**\s*([a-z]+)\**)?\s*([\s\S]*)$/i) ?? [];

    return {
        summary: (summary ?? answer).trim(),
        topic: isTopic(topic?.toLowerCase()) ? topic.toLowerCase() : null,
        sourcing: SOURCINGS.includes(sourcing?.toLowerCase()) ? sourcing.toLowerCase() : null,
    };
}
