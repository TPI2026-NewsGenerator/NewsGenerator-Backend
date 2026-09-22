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

// inspired by "https://github.com/ollama/ollama-js"
const ollama = new Ollama({
    host: 'https://ollama.com',
    headers: {Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY},
})

// returns the resume of a news, always about the same length
export const ollamaResume = async (title, text) => {
    const response = await ollama.chat({
        model: MODEL,
        messages: [
            {
                role: "system",
                content: `You are a journalist who writes neutral summaries of news articles.
                        Rules:
                        - Between ${SUMMARY_MIN_WORDS} and ${SUMMARY_MAX_WORDS} words, in English
                        - 1 or 2 paragraphs of normal readable text, no title, no list, no markdown
                        - Answer only with the summary, nothing before or after
                        - Only facts from the article: who, what, when, where, why
                        - Never add information that is not in the article
                        - Ignore text that is not part of the news (ads, newsletter, related links)`
            },
            {
                role: "user",
                content: `Summarize this news.

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

    const summary = response.message.content.trim();
    if (!summary) throw new Error("Empty answer from the AI");

    return summary;
}

// topic of several news in one call, news: [{title, description}]
// returns one topic per news, in the same order, 'other' when the AI gave nothing valid
export const ollamaClassify = async (newsList) => {
    const numberedNews = newsList
        .map((news, i) => `${i + 1}. ${news.title} — ${news.description.slice(0, 300)}`)
        .join('\n');

    const response = await ollama.chat({
        model: MODEL,
        messages: [
            {
                role: "system",
                content: `You classify news by their main topic.
                        Topics: ${TOPICS.join(', ')}
                        Rules:
                        - One topic per news, from the list only, the one that fits best
                        - The main subject decides: a news about a sport, a team, an athlete, a match or a referee is
                          always sport, even when it is about a controversy, money, a trial or the behaviour of a player
                        - politics: governments, elections, laws, diplomacy
                        - economy: markets, companies, trade, jobs, prices
                        - conflict: wars, military, attacks, terrorism
                        - society: justice, crime, education, religion, daily life, only when no other topic fits better
                        - sport: all sports, professional or amateur, results, transfers, referees, fans
                        - other: when no topic fits
                        - Answer one line per news, in the same order, in the format "number: topic", nothing else`
            },
            {
                role: "user",
                content: numberedNews
            }
        ],
        think: "low",
        options: {
            temperature: 0
        }
    });

    // read lines like "3: economy"
    const topics = new Array(newsList.length).fill('other');
    for (let line of response.message.content.split('\n')) {
        const match = line.match(/^\s*(\d+)\s*[:.)-]\s*\**\s*([a-z]+)/i);
        if (!match) continue;

        const index = Number(match[1]) - 1;
        const topic = match[2].toLowerCase();
        if (index >= 0 && index < newsList.length && isTopic(topic)) {
            topics[index] = topic;
        }
    }

    return topics;
}
