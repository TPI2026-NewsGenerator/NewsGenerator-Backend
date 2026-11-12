//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: timeline-relevance.js
//  Description: "The story so far" of a card, only the earlier news of ITS affair. The thread of a card gathers the stories that look alike
//               (bge-m3, 0.75 on average), so the card of the FKF of Kenya asking a FIFA normalisation committee had six lines of the NFF
//               of Nigeria asking one (a friend of the user, 12.11.2026). Neither the countries of the items the news name (17 lines cut
//               of 167, 8 of them of the same affair: the FIFA files, a tournament, a report seen by two countries) nor the likeness of the
//               stories (the lines of one affair are as low as the strangers) tell them apart (bench/timeline-so-far), so an AI reads the
//               titles of the lines against the card: one call a card that has an analysis, never a failure of the briefing
//

"use strict"

import {ollamaJson} from './ollama.js';

export const RELATED_DEFINITION = `A card is a news of today. Below it are earlier stories that a database put in the same thread because they look alike. Keep the ones that are part of the SAME STORY as the card: one continuing affair (a dispute, an election, a case, a controversy, a transfer, a competition, a match) with the same parties, of which the card is a new step. Earlier steps, causes, other candidates of the same election, other episodes of the same controversy, earlier rounds of the same competition for the same team all belong to it.
Do NOT keep: the same kind of story somewhere else with other parties (the federation of another country, another club, another player going through something similar); another subject that only shares the organisation or the competition (the other sports of the same Games, the other matches of a league, news of FIFA that does not concern the parties of the card); a story that only shares a word or a name in passing.
Judge by the titles. A card may have none: answer an empty list. Do not keep a line only because it looks alike.`;

export const SUMMARY_CHARS = 300;
const TIMEOUT_MS = 90e3;

// card: {title, summary}; lines: [{date, title, medium}], the oldest first or the newest, as they come
export const relatedPrompt = (card, lines) => `${RELATED_DEFINITION}

CARD: ${card.title}
${String(card.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS)}

EARLIER STORIES:
${lines.map((line, i) => `[${i + 1}] ${line.date ?? ''} ${line.medium ?? ''}: ${line.title}`).join('\n')}

Answer only in JSON: {"same": [numbers of the stories of the same affair]}`;

// the places (from 0) the AI kept, or null when its answer is no list: it said nothing about the lines, so none is taken out
export const normalizeRelated = (answer, count) => {
    if (!Array.isArray(answer?.same)) return null;
    const places = answer.same.map(n => Number(String(n ?? '').replace(/^\[|\]$/g, '')) - 1);
    return [...new Set(places.filter(place => Number.isInteger(place) && place >= 0 && place < count))];
};

// The lines of the same affair as the card, in their order; the lines as they came when the AI could not say (the card is never kept waiting)
export const relatedLines = async (card, lines, usage = null, ask = ollamaJson) => {
    if (lines.length === 0) return lines;
    try {
        const kept = normalizeRelated(await ask(relatedPrompt(card, lines), usage, {timeoutMs: TIMEOUT_MS}), lines.length);
        return kept === null ? lines : lines.filter((line, i) => kept.includes(i));
    } catch (err) {
        console.error(`Story so far: the lines of "${String(card.title).slice(0, 60)}" were not read (${err.message})`);
        return lines;
    }
};
