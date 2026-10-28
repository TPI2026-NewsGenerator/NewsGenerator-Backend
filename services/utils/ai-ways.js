//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: ai-ways.js
//  Description: The points and the summary of a card written by the AI, shown only when the reader asks for
//               them ("Show AI version") next to the ones made of the article's own sentences, marked as
//               written by the AI. For the readers to compare: the cards keep their published sentences
//

"use strict"

import process from 'node:process';
import {figuresOf, sentencesOf} from './extract.js';
import {writtenIn} from './language.js';
import {ollamaJson} from './ollama.js';

// Measured on 30 articles, 2 runs each (bench/formats-models.mjs, data/faithful/models-table.md,
// 15.10.2026), thinking off: articles with a meaning error, points / summary, deepseek-v4-pro 1-2 / 2,
// kimi-k3 1-2 / 2-3, gemma4:31b 2-3 / 2, published sentences 0. deepseek-v4-pro writes clearest
// (3 unclear references in its summaries, gemma 12) at 4.9 s a call, kimi-k3 alike at 9.2 s and
// three times its cost. No model is error free: hence a version the reader asks for, marked
export const WRITE_MODEL = process.env.OLLAMA_WRITE_MODEL || 'deepseek-v4-pro:0813';
const SUMMARY_WORDS = 65;
const MAX_POINTS = 4;
const ATTEMPTS = 2;

// the four rules of the faithfulness bench (28.09.2026: 4/30 meanings changed without them, 0/30 with)
// and the ones of 12.10, the prompts of bench/formats-prompts.mjs as measured
const RULES = (language) => `- Every word is in ${language}, whatever the language of the article: translate its phrases.
  Only names (people, organisations, places, laws) stay as they are.
- Only facts from the article. Never add information that is not in it.
- Each statement keeps who said or did it in the article: never give the words or the act of one
  person to another, or to a group.
- Never link two facts by a cause or a purpose (because, to, so that) the article does not state.
- Keep the certainty of the article: what it says is likely, alleged, planned or unconfirmed stays so,
  and what it says is almost certain is not made doubtful.
- Never add a place, a date, a role, a title or a gender the article does not give.
- Figures exactly as the article gives them.
- No quotation marks: what someone said is told as "X says that...".
- A sentence marked (quote) is someone's words quoted by the article, never what the article itself says.
- Ignore text that is not the news: ads, cookies, subscriptions, "read also", captions, credits.`;

const numbered = (sentences) => sentences.map((sentence, i) => `[${i + 1}]${sentence.quote ? ' (quote)' : ''} ${sentence.text}`).join('\n');

export const pointsPrompt = (title, sentences, language) => `You write the key points of a news article for a reader in ${language}.
Rules:
- 3 or 4 points, 2 for a short article, the most important first. Together they say who did what,
  when and where, and the main figures.
- Each point is one short sentence of at most 15 words.
${RULES(language)}
- For each point, the numbers of the sentences of the article it comes from, in "sentences" only,
  never in its text.

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"points": [{"text": "...", "sentences": [numbers]}]}`;

export const summaryPrompt = (title, sentences, language) => `You write a short summary of a news article for a reader in ${language}.
Rules:
- One paragraph of normal readable text, at most ${SUMMARY_WORDS} words (5 lines), no title, no list.
  The most important first: who did what, when and where, and the main figures.
${RULES(language)}
- The numbers of the sentences of the article it comes from, in "sentences" only, never in the text.

TITLE: ${title}

SENTENCES:
${numbered(sentences)}

Answer only in JSON: {"summary": "...", "sentences": [numbers]}`;

// the numbers of sentences the AI still writes in its text, about 1 answer in 30: "... 580 000 unités [13]."
const unnumbered = (text) => text.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, '').replace(/\s+/g, ' ').trim();
// a text of the AI keeps no figure the article does not give, checked rather than trusted
const figuresFrom = (text, source) => figuresOf(text).every(figure => source.has(figure));

// The points and the summary written by the AI in the reader's language (a code), from the same sentences
// as the key passages: {points: ['...'], summary: '...', model}, either null when its call failed, gave
// nothing usable or a figure the article does not have, twice (ATTEMPTS). null when there is nothing to
// write from
export const aiWaysOf = async (title, page, {language = 'en', usage = null} = {}) => {
    const sentences = page ? sentencesOf(page) : [];
    const reader = writtenIn(language);
    if (sentences.length === 0 || !reader) return null;
    const source = new Set(figuresOf(`${title} ${sentences.map(sentence => sentence.text).join(' ')}`));
    const ask = (prompt) => ollamaJson(prompt, usage, {model: WRITE_MODEL, think: false}).catch(err => {
        console.error(`AI version: ${WRITE_MODEL} did not answer (${err.message})`);
        return null;
    });
    // Each text is asked up to ATTEMPTS times: a call that failed, an answer that is no JSON or one with a
    // figure the article does not give is a slip of the model, not a fact of the article. 5 % of the cards of
    // 4 days had no points or no summary (28.10.2026)
    const written = async (prompt, textsOf) => {
        let rejected = false;
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const texts = textsOf(await ask(prompt));
            if (texts.length > 0 && texts.every(text => figuresFrom(text, source))) return {texts, rejected};
            rejected ||= texts.length > 0;
        }
        return {texts: [], rejected};
    };
    const [points, summary] = await Promise.all([
        written(pointsPrompt(title, sentences, reader), answered => (Array.isArray(answered?.points) ? answered.points : [])
            .map(point => unnumbered(typeof point === 'string' ? point : point?.text ?? '')).filter(Boolean).slice(0, MAX_POINTS)),
        written(summaryPrompt(title, sentences, reader), answered => typeof answered?.summary === 'string' && unnumbered(answered.summary) ? [unnumbered(answered.summary)] : []),
    ]);
    if ((points.rejected && points.texts.length === 0) || (summary.rejected && summary.texts.length === 0)) {
        console.log(`AI version: a text of "${title.slice(0, 60)}" left out, a figure the article does not give`);
    }
    const ways = {points: points.texts.length > 0 ? points.texts : null, summary: summary.texts[0] ?? null};
    return ways.points || ways.summary ? {...ways, model: WRITE_MODEL} : null;
};
