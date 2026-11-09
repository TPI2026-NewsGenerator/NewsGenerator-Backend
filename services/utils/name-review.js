//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: name-review.js
//  Description: The names a card shows that are no names (the user, 9.11.2026: a chip "refereeing" on a card of Corsica). Of the 347 names in
//               Latin letters of the cards of the last 80 briefings that no item of Wikidata stands for, gemma4:31b, asked once for a
//               briefing's names, pointed at 73 that are none: the pairing of two teams ("Genoa-Milan", 25), a name joined to a word
//               ("FIFA-Präsident", 13), a common noun ("Hotline", "Policija", "Clubs", "Former Referee", 19), a fragment ("FC", "UEFA-e", 8),
//               a word in capitals (8); and none of the clubs, the federations and the persons (a nickname of a team, "Pharaons", and a
//               few words in capitals were the doubtful ones). It misses the names written in a declined form ("Manchesteru City"). The
//               AI points, the code decides: only a name with NO item of Wikidata is left out, never one that is linked, and an AI that
//               points at most of a briefing's names is not believed. What it left out is logged and written on the card (namesLeftOut)
//
//  A name linked to a concept of Wikidata ("refereeing", "public prosecutor's office": a label with no capital letter) is left out by
//  card-names.js (withoutConcepts), without the AI
//

"use strict"

import process from 'node:process';
import {mapWithConcurrency} from './concurrency.js';
import {ollamaJson} from './ollama.js';

export const NAMES_AT_ONCE = 40;
const CALLS_AT_ONCE = 3;
const DEADLINE_MS = 60e3;
const CALL_TIMEOUT_MS = 45e3;
// an AI that points at more than this share of the names it was given (over a few of them) is not believed: it took the question for another
const MAX_SHARE = 0.6;
const MIN_FOR_SHARE = 6;

const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// The names of a briefing that no item of Wikidata stands for, once each, with the kind the tagger gave and the title of the first card that
// shows it: [{name, kind, title}]
export const namesToReview = (items) => {
    const seen = new Map();
    for (const item of items) for (const name of item.names ?? []) {
        if (name?.qid || !name?.name || seen.has(name.name)) continue;
        seen.set(name.name, {name: name.name, kind: name.kind, title: clip(item.titleTranslation ?? item.title, 90)});
    }
    return [...seen.values()];
};

// the prompt measured on 9.11.2026: "when in doubt, it is a name"
export const reviewPrompt = (entries) => `Here are names that a news app shows as "people and organisations" under a news card. Each has the title of the card it is on.

${entries.map((entry, i) => `[${i + 1}] ${entry.name} (${entry.kind}) — card: ${entry.title}`).join('\n')}

Which of these are NOT the proper name of a person or an organisation? Answer for: a common noun or a word of the language ("refereeing", "police", "hotline"), the title of a match or a pairing of two teams ("Genoa-Milan"), a name joined to a common word by a hyphen ("FIFA-president"), a fragment of a name, a word in capitals that is no name. A club, a federation, a league, a company, an acronym of one, a nickname of a team, and a person are names. When in doubt, it is a name. Answer only in JSON: {"not_names": [{"n": number, "why": "common noun" or "match" or "compound" or "fragment" or "other"}]}`;

// The numbers of an answer, from zero, with why: Map index -> why. What is not of this shape, or out of the list, is dropped
export const normalizeNotNames = (answer, count) => {
    const flagged = new Map();
    for (const one of Array.isArray(answer?.not_names) ? answer.not_names : []) {
        const index = Number(one?.n) - 1;
        if (Number.isInteger(index) && index >= 0 && index < count) flagged.set(index, clip(one?.why, 20) || 'other');
    }
    return flagged;
};

// Map name -> why of the names the AI says are none, for the cards of a briefing. Never throws: the AI failing, answering what cannot be read,
// taking too long, or pointing at most of the names leaves the cards as they are. AI_NAME_REVIEW=off switches it off
export const reviewNames = async (items, {usage = null, label = 'unsaved', log = console} = {}) => {
    const entries = namesToReview(items);
    if (entries.length === 0 || process.env.AI_NAME_REVIEW === 'off') return new Map();
    const started = Date.now();
    let timer;
    try {
        const chunks = Array.from({length: Math.ceil(entries.length / NAMES_AT_ONCE)}, (_, i) => entries.slice(i * NAMES_AT_ONCE, (i + 1) * NAMES_AT_ONCE));
        const reading = mapWithConcurrency(chunks, CALLS_AT_ONCE, async (chunk) => {
            const answer = await ollamaJson(reviewPrompt(chunk), usage, {timeoutMs: CALL_TIMEOUT_MS});
            return [...normalizeNotNames(answer, chunk.length)].map(([index, why]) => [chunk[index].name, why]);
        });
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        const results = await Promise.race([reading, late]);
        const flagged = new Map();
        for (const result of results) {
            if (result.status === 'fulfilled') result.value.forEach(([name, why]) => flagged.set(name, why));
            else log.error(`Briefing ${label}: names: some names were not reviewed (${result.reason?.message})`);
        }
        if (entries.length >= MIN_FOR_SHARE && flagged.size > MAX_SHARE * entries.length) {
            log.error(`Briefing ${label}: names: the AI points at ${flagged.size} of ${entries.length} names with no item, not believed, none is left out`);
            return new Map();
        }
        log.log(`Briefing ${label}: names: ${entries.length} names with no item reviewed in ${Math.round((Date.now() - started) / 1000)} s (tokens ${JSON.stringify(usage)}), ${flagged.size} are no names`);
        return flagged;
    } catch (err) {
        log.error(`Briefing ${label}: names: the names were not reviewed (${err.message})`);
        return new Map();
    } finally {
        clearTimeout(timer);
    }
};

// The cards without the names with no item that the AI said are none (flagged: Map name -> why, see reviewNames). The card says which, in
// namesLeftOut; the cards with none of them are the same objects
export const withoutNonNames = (items, flagged, {label = 'unsaved', log = console} = {}) => items.map(item => {
    const left = (item.names ?? []).filter(name => !name.qid && flagged.has(name.name));
    if (left.length === 0) return item;
    for (const name of left) log.log(`Briefing ${label}: names: "${name.name}" (${flagged.get(name.name)}) left out of the card "${clip(item.titleTranslation ?? item.title, 50)}"`);
    return {...item, names: item.names.filter(name => !left.includes(name)), namesLeftOut: left.map(name => ({name: name.name, why: flagged.get(name.name)}))};
});
