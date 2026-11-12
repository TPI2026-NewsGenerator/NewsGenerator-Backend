//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: sent-repeats.js
//  Description: A card that tells the news of a card the reader got BY E-MAIL, however long ago, does not come back, unless it tells something new or the
//               reader follows its affair (the user, 12.11.2026: a news sent by e-mail is not shown again the next day or the days after, unless the
//               story evolved or the reader ticked "Follow this affair"). repeats.js does it before the AI chooses, on the stories chosen only: a story
//               joined to a card afterwards (a version in the reader's language, a version in another one, see keepSameNews) is never looked at, and
//               its question "did it evolve?" answers yes for 42 of 48 cards (a living affair always has news since), so 18 of 20 repeats stayed
//               (bench/dup-eval.mjs evolve, 12.11.2026). Here the cards are written and read:
//               1. the candidates: a card that shares a story with a card sent (free), and the cards a reader of the whole list pairs with a card sent
//               2. each candidate pair is looked at with the full texts of both cards: "does the card of today tell the reader something new?"
//                  The look is strict ("a figure, a statement, a new step that the other lacks is a development"): of the 29 repeats among 98 pairs
//                  judged blind it finds 11 and hides no development (deepseek reasoning: 14 and 1 development). Loosened, it hides 40% of them
//               The AI proposes, the code decides, and nothing is left out on doubt: a reader that fails, a look that is not answered or is not
//               "same", an affair followed, a card with no card sent to compare with, all keep the card
//

"use strict"

import process from 'node:process';
import {ollamaJson} from './ollama.js';
import {writtenIn} from './language.js';
import {mapWithConcurrency} from './concurrency.js';
import {withoutOriginalMarks, UNCHECKED} from './original-marks.js';

// A news sent is acquired for good (the user, 12.11.2026: "du moment que la nouvelle a été envoyée par mail elle est acquise, même 48 h après"). The cards
// sent are read back as far as the stories they were made of are kept (RETENTION_DAYS = 30): after that a card has no story, no vector to find it by.
// Beyond the 48 h of repeats.js 21 of 725 cards told again a card sent 2 to 11 days before (judged blind, bench/dup-eval.mjs olderWrite): the look finds 4
// of them (all within 4 days: later the news is told again with more details, which the strict look calls a development) and hides none of 85 others
export const SENT_DAYS = 30;
// What brings a card sent to the look when the reader of the list did not give it: the cosine of the centroids of their stories, the closest card sent of each
// card of today. At 0.70 it holds 18 of the 21 repeats and gives 7 cards a briefing to look at, at 0.75 13 and 5 (0.85: 9 and 2). The look found 4 of the 21, all of
// a high likeness, so 0.75: a live briefing with 0.70 and every pair gave 137 pairs, 13 looks and 18 500 tokens for no card left out
export const SENT_LIKENESS = 0.75;
const RECEIVED_MAX = 80;            // the cards sent shown to the reader of the list: the newest, one per story
const CANDIDATES_PER_CARD = 2;      // the cards sent a card is looked at against
const LOOKS_MAX = 20;               // looks for a briefing
const LOOK_CONCURRENCY = 3;
const TODAY_WORDS = 50;
const RECEIVED_WORDS = 30;
const TEXT_PARAGRAPHS = 3;
const READER_TIMEOUT_MS = 90e3;
const LOOK_TIMEOUT_MS = 90e3;
const DEADLINE_MS = 150e3;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const words = (text, n) => norm(text).split(' ').filter(Boolean).slice(0, n).join(' ');
const plain = (text) => withoutOriginalMarks(String(text ?? '')).replaceAll(UNCHECKED, '');
const paragraphs = (text) => plain(text).split(/\n\n/).slice(0, TEXT_PARAGRAPHS).map(norm).filter(Boolean).join('\n');
const idsOf = (storyId, merged) => new Set([storyId, ...(Array.isArray(merged) ? merged : [])].filter(id => Number.isInteger(id) && id > 0));

// The model of the look: gemma4:31b with reasoning (11 of the 29 repeats, no development hidden; deepseek-v4-pro with reasoning 15 and 1 for about
// 11 times the price), OLLAMA_REPEAT_MODEL for another. The reader of the list is the model of the briefing
const lookOptions = () => process.env.OLLAMA_REPEAT_MODEL
    ? {model: process.env.OLLAMA_REPEAT_MODEL, think: true, fallback: null, timeoutMs: LOOK_TIMEOUT_MS}
    : {think: true, timeoutMs: LOOK_TIMEOUT_MS};

// A card of today as the readers see it: {ids, title, text, source, media}
export const viewOf = (item) => ({
    ids: idsOf(item.storyId, item.mergedStoryIds),
    title: norm(item.titleTranslation ?? item.title),
    text: plain(item.translation ?? item.summary),
    source: item.lead?.source ?? '',
    media: Number(item.corroboration?.media) || 1,
});

// The cards sent by e-mail in the last SENT_DAYS, one per story (the last time it was sent), the oldest first.
// rows: see BriefingModel.sentCardsSince: [{storyId, mergedStoryIds, title, text, source, media, shownAt}]
export const receivedCards = (rows) => {
    const byStory = new Map();
    for (const row of rows) {
        const ids = idsOf(row.storyId, row.mergedStoryIds);
        if (!(row.storyId > 0) || ids.size === 0) continue;       // a card the reader added (a negative id) is of no story
        byStory.set(row.storyId, {ids, title: norm(row.title), text: plain(row.text), source: row.source ?? '', media: Number(row.media) || 1, shownAt: new Date(row.shownAt)});
    }
    return [...byStory.values()].sort((a, b) => a.shownAt - b.shownAt);
};

// ---- 1. the candidates
// the prompt measured on 12.11.2026 (bench/dup-eval.mjs cross): the cards of today that tell the SAME NEWS as a card received
export const listPrompt = (today, received, language) => {
    const view = (card, label, n) => `[${label}] ${card.title}\n    ${words(card.text, n)}`;
    return `A reader already received these cards in earlier briefings (R1, R2...), then gets a new briefing (T1, T2...). The reader reads in ${writtenIn(language) ?? language}.

RECEIVED BEFORE:
${received.map((card, i) => view(card, `R${i + 1}`, RECEIVED_WORDS)).join('\n')}

TODAY:
${today.map((card, i) => view(card, `T${i + 1}`, TODAY_WORDS)).join('\n')}

Find the cards of TODAY that tell THE SAME NEWS as a card RECEIVED BEFORE: the same event, decision, statement or result, so that a reader who has read the received card learns nothing new from the card of today. A card of today on the same affair that tells a different fact is NOT the same news: a reaction to it, a question and its answer, the next step, a consequence, what another person said, another match, another person, a later stage.

When in doubt, do not group. Answer only in JSON: {"repeats": [{"today": number, "received": number, "same": "the one fact they both tell"}]}`;
};

const numberOf = (value) => Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);

// The pairs of an answer as indexes from zero [today, received]: what is not a card of the list is dropped
export const normalizeRepeats = (answer, todayCount, receivedCount) => (Array.isArray(answer?.repeats) ? answer.repeats : [])
    .map(one => [numberOf(one?.today), numberOf(one?.received)])
    .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 1 && x <= todayCount && y >= 1 && y <= receivedCount)
    .map(([x, y]) => [x - 1, y - 1]);

// The cards of today that share a story (their own or one joined to them) with a card sent: [today, received]
export const sharedPairs = (today, received) => today.flatMap((card, i) => received.flatMap((old, j) => [...card.ids].some(id => old.ids.has(id)) ? [[i, j]] : []));

// The pairs [today, received, likeness] the centroids of the stories say are close (rows: [{a: a story of a card sent, b: a story of a card of today,
// likeness}], see StoryModel.likenessBetween), the closest first, each pair once
export const closePairs = (today, received, rows) => {
    const best = new Map();
    const holder = (cards, id) => cards.findIndex(card => card.ids.has(id));
    for (const row of rows) {
        const i = holder(today, row.b), j = holder(received, row.a);
        if (i < 0 || j < 0) continue;
        const key = `${i}:${j}`;
        if (!best.has(key) || best.get(key)[2] < row.likeness) best.set(key, [i, j, row.likeness]);
    }
    return [...best.values()].sort((x, y) => y[2] - x[2]);
};

// ---- 2. the look at a pair
// the wording measured on 12.11.2026 (bench/dup-eval.mjs strict): the first reader's definition of the verdicts, strict on the details. The wording
// "does B report a new EVENT" (details do not count) called 23 of 56 developments the same news and was dropped
export const lookPrompt = (old, card) => `A reader received Card A in an earlier briefing. Today's briefing holds Card B.

Card A: ${old.title} (${old.source}, ${old.media} media)
${paragraphs(old.text)}

Card B: ${card.title} (${card.source}, ${card.media} media)
${paragraphs(card.text)}

Give ONE verdict:
- SAME: both cards report the same news: the same event, decision, statement or result. A reader who has read Card A learns nothing material from Card B. Different wording, a different medium, or a small extra detail does not make them different news.
- DEVELOPMENT: the same affair or topic, but Card B tells at least one fact Card A does not that matters to a reader: a reaction, a question and its answer, the next step, a consequence, what another person said, another stage (announcement vs result), another match or person.
- DIFFERENT: not the same affair, or only the same broad subject.

Be strict: if Card B has a fact (a figure, a person's statement, a new step) that Card A lacks and that matters to a reader, it is DEVELOPMENT. When both cards tell the same fact, it is SAME even if the titles look unlike.

Answer only in JSON: {"verdict": "SAME" or "DEVELOPMENT" or "DIFFERENT", "why": "one short sentence"}`;

export const normalizeLook = (answer) => {
    const verdict = String(answer?.verdict ?? '').trim().toUpperCase();
    return ['SAME', 'DEVELOPMENT', 'DIFFERENT'].includes(verdict) ? verdict : null;
};

const dayOf = (date) => date.toISOString().slice(0, 10);

// The cards of the briefing that repeat a card sent: [{index, storyId, title, earlier: {title, shownAt}}]. 'followed': the ids of the stories of the
// affairs the reader follows, a card of one of them is never left out. Never throws: nothing is left out on a failure or a doubt.
// AI_SENT_REPEATS=off switches it off
export const repeatedCards = async (items, received, language, {usage = null, label = 'unsaved', log = console, followed = new Set(), close = []} = {}) => {
    if (items.length === 0 || received.length === 0 || process.env.AI_SENT_REPEATS === 'off') return [];
    const started = Date.now();
    let timer;
    try {
        const today = items.map(viewOf);
        const exempt = today.map(card => [...card.ids].some(id => followed.has(id)));
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        const run = async () => {
            const shared = sharedPairs(today, received);
            const near = [...new Map(closePairs(today, received, close).reverse().map(([i, j]) => [i, [i, j]])).values()];
            // the reader of the list is shown the newest cards sent only; a reader that fails leaves the other candidates (the stories shared, the stories close) to the look
            const shown = received.slice(-RECEIVED_MAX);
            const offset = received.length - shown.length;
            const listed = await ollamaJson(listPrompt(today, shown, language), usage, {timeoutMs: READER_TIMEOUT_MS})
                .then(answer => normalizeRepeats(answer, today.length, shown.length).map(([i, j]) => [i, j + offset]), err => {
                    log.error(`Briefing ${label}: sent repeats: the reader of the list did not answer (${err.message}), only the stories shared or close are looked at`);
                    return [];
                });
            const seen = new Set();
            const pairs = [...shared, ...listed, ...near].filter(([i, j]) => !exempt[i] && !seen.has(`${i}:${j}`) && seen.add(`${i}:${j}`));
            const byCard = new Map();
            for (const [i, j] of pairs) byCard.set(i, [...(byCard.get(i) ?? []), j].slice(0, CANDIDATES_PER_CARD));
            const asked = [...byCard].sort((a, b) => a[0] - b[0]).flatMap(([i, list]) => list.map(j => [i, j])).slice(0, LOOKS_MAX);
            const looks = await mapWithConcurrency(asked, LOOK_CONCURRENCY, async ([i, j]) => normalizeLook(await ollamaJson(lookPrompt(received[j], today[i]), usage, lookOptions())));
            const repeated = new Map();
            asked.forEach(([i, j], k) => {
                if (looks[k].status === 'fulfilled' && looks[k].value === 'SAME' && !repeated.has(i)) repeated.set(i, j);
            });
            const failed = looks.filter(look => look.status === 'rejected' || look.value === null).length;
            log.log(`Briefing ${label}: sent repeats: ${shared.length} cards share a story with a card sent, ${listed.length} pairs by the reader, ${near.length} close in the vectors, ${asked.length} looked at${failed ? ` (${failed} not answered)` : ''}, ${repeated.size} left out, ${Math.round((Date.now() - started) / 1000)} s (tokens ${JSON.stringify(usage)})`);
            return [...repeated].map(([i, j]) => ({index: i, storyId: items[i].storyId, title: today[i].title, earlier: {title: received[j].title, shownAt: received[j].shownAt}}));
        };
        return await Promise.race([run(), late]);
    } catch (err) {
        log.error(`Briefing ${label}: sent repeats: the cards were not looked at (${err.message})`);
        return [];
    } finally {
        clearTimeout(timer);
    }
};

// The cards without the ones that repeat a card sent (by their story: the cards of the briefing may have been folded or reordered since)
export const withoutSentRepeats = (items, repeated, {label = 'unsaved', log = console} = {}) => {
    if (repeated.length === 0) return items;
    const gone = new Set(repeated.map(one => one.storyId));
    for (const one of repeated) log.log(`Briefing ${label}: sent repeats: "${one.title.slice(0, 80)}" is left out, it tells the news of "${one.earlier.title.slice(0, 80)}" sent on ${dayOf(one.earlier.shownAt)}`);
    return items.filter(item => !gone.has(item.storyId));
};
