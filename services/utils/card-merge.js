//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: card-merge.js
//  Description: Two cards of one briefing that tell the same news (the user, 9.11.2026: "des fois la même histoire est présentée sur 2 cartes
//               différentes sur le même briefing"). Measured on 864 cards of 40 saved briefings, pairs judged by two readers blind to the
//               models: 18 true pairs in 12 briefings (30 %). The cards are read again as a whole once written (as the proofreading does,
//               proofread.js), by two readers: gemma4:31b and deepseek-v4-pro (reasoning), each answering which cards tell the SAME news.
//               Only the pairs BOTH readers give are kept (14 of the 18 true ones, 1 wrong of 15, where gemma alone was wrong 11 times of
//               27 and deepseek alone 3 of 19). The card that is the second of the news is not removed: it is put among the angles of the
//               other, with its title and its link, and its media are counted with that card's. A pair that was a development of one
//               affair, not one news, is then still one click away, where a development belongs: no news is hidden
//
//  The AI proposes, the code decides, and the decision can be undone by the reader: the same rule as the proofreading and the neutral titles
//

"use strict"

import process from 'node:process';
import {ollamaJson} from './ollama.js';
import {writtenIn} from './language.js';
import {withoutOriginalMarks, UNCHECKED} from './original-marks.js';

// the second reader: reasoning, never answered by another model (a vote of gemma with itself would be no vote)
export const MERGE_MODEL = process.env.OLLAMA_MERGE_MODEL || 'deepseek-v4-pro:0813';
const PASSAGE_WORDS = 50;
const NAMES = 5;
// the readers are not waited for longer than this: reasoning takes 40 s a briefing, 120 s is a call that does not answer
const FAST_TIMEOUT_MS = 90e3;
const SLOW_TIMEOUT_MS = 120e3;
const DEADLINE_MS = 130e3;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const clip = (text, n) => norm(text).split(' ').slice(0, n).join(' ');
const mediaOf = (item) => Number(item?.corroboration?.media) || 1;

// What a reader is shown of a card: its title as the reader sees it, how many media tell it, the people and organisations it names and the
// first sentences of its text
const viewOf = (item) => ({
    title: norm(item.titleTranslation ?? item.title),
    media: mediaOf(item),
    names: (item.names ?? []).slice(0, NAMES).map(name => name.name).filter(Boolean),
    passage: clip(withoutOriginalMarks(String(item.translation ?? item.summary ?? '').split(/\n\n/)[0]).replaceAll(UNCHECKED, ''), PASSAGE_WORDS),
});

// the prompt measured on 9.11.2026 (bench/duplicate-cards.mjs): the cards that tell THE SAME NEWS, "when in doubt, do not group"
export const mergePrompt = (items, language) => `Here are the cards of a news briefing, each with its number, its title, how many media tell it, the first sentences of its text and the people and organisations it names. The reader reads in ${writtenIn(language) ?? language}.

${items.map(viewOf).map((view, i) => `[${i + 1}] ${view.title}\n    ${view.media} media${view.names.length ? ` | names: ${view.names.join(', ')}` : ''}\n    ${view.passage}`).join('\n\n')}

Find the cards that tell THE SAME NEWS: the same event, decision, statement or result, so that a reader who has read one learns nothing new from the other. Cards on the same affair that tell a different fact are NOT the same news: a reaction to it, a question and its answer, the next step, a consequence, what another person said, another match, another person, an earlier or a later stage.

When in doubt, do not group. Most briefings have no such cards. Answer only in JSON: {"groups": [{"cards": [numbers], "same": "the one fact they all tell"}]}`;

// The groups of an answer, as sorted indexes of the cards (from 0): what is not a list of two cards or more of the briefing is dropped
export const normalizeGroups = (answer, count) => (Array.isArray(answer?.groups) ? answer.groups : [])
    .map(group => [...new Set((Array.isArray(group?.cards) ? group.cards : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= count).map(n => n - 1))].sort((a, b) => a - b))
    .filter(group => group.length >= 2);

const pairsOf = (groups) => new Set(groups.flatMap(group => group.flatMap((a, i) => group.slice(i + 1).map(b => `${a}-${b}`))));

// The groups both readers give: the pairs they both give, joined into a group only when every card of it is paired with every other one by both
// (A with B and B with C do not make A with C: a chain of "similar" is how a development of an affair is taken for its news)
export const agreedGroups = (first, second) => {
    const a = pairsOf(first), b = pairsOf(second);
    const agreed = [...a].filter(pair => b.has(pair)).map(pair => pair.split('-').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const together = (x, y) => agreed.some(([i, j]) => i === Math.min(x, y) && j === Math.max(x, y));
    const groups = [];
    for (const [i, j] of agreed) {
        const gi = groups.find(group => group.includes(i)), gj = groups.find(group => group.includes(j));
        if (gi && gi === gj) continue;
        if (!gi && !gj) groups.push([i, j]);
        else if (gi && !gj && gi.every(x => together(x, j))) gi.push(j);
        else if (gj && !gi && gj.every(x => together(x, i))) gj.push(i);
        else if (gi && gj && gi.every(x => gj.every(y => together(x, y)))) { gi.push(...gj); groups.splice(groups.indexOf(gj), 1); }
    }
    return groups.map(group => group.sort((x, y) => x - y));
};

// ---- the fold: the second card of the news becomes an angle of the other
// the card as an angle, as the angles of a card are (anglesOf of briefing-service.js): the title the reader saw, its translation, the article
// of the card, how many media tell it. 'folded': it was a card of the briefing
const angleOf = (card) => ({
    ...(card.lead ?? {}),
    title: card.title ?? card.lead?.title,
    titleTranslation: card.titleTranslation ?? null,
    ...(card.language ? {language: card.language} : {}),
    storyId: card.storyId,
    media: mediaOf(card),
    folded: true,
});

const byUrl = (list) => {
    const seen = new Set();
    return list.filter(one => {
        if (!one?.url) return true;
        if (seen.has(one.url)) return false;
        seen.add(one.url);
        return true;
    });
};

// The card with the cards of the same news put among its angles, its articles and media counted with theirs
const withFolded = (card, others) => {
    const gone = new Set(others.flatMap(other => [other.storyId, ...(other.mergedStoryIds ?? [])]));
    const urls = new Set(others.map(other => other.lead?.url).filter(Boolean));
    const mediaNames = [...new Set([...(card.corroboration?.mediaNames ?? []), ...others.flatMap(other => other.corroboration?.mediaNames ?? [])])];
    return {
        ...card,
        angles: [...others.map(angleOf), ...(card.angles ?? []).filter(angle => !gone.has(angle.storyId) && !urls.has(angle.url))],
        articles: byUrl([...(card.articles ?? []), ...others.flatMap(other => other.articles ?? [])]),
        corroboration: card.corroboration ? {...card.corroboration, media: Math.max(mediaOf(card), mediaNames.length), mediaNames} : card.corroboration,
        mergedStoryIds: [...new Set([...(card.mergedStoryIds ?? []), ...[...gone].filter(id => Number.isInteger(id) && id !== card.storyId)])],
        joinedCards: [...(card.joinedCards ?? []), ...others.map(other => ({storyId: other.storyId, title: norm(other.titleTranslation ?? other.title)}))],
    };
};

// The cards of a briefing without the second card of each group: the card of a group that is the best covered (more media, then the first)
// keeps its content and takes the place of the first of them; the others are among its angles. Cards not in a group are the same objects
export const foldCards = (items, groups, {label = 'unsaved', log = console} = {}) => {
    const dropped = new Set();
    const placed = new Map();
    for (const group of groups) {
        const keeper = group.reduce((best, i) => mediaOf(items[i]) > mediaOf(items[best]) ? i : best, group[0]);
        const others = group.filter(i => i !== keeper);
        placed.set(group[0], withFolded(items[keeper], others.map(i => items[i])));
        for (const i of group) if (i !== group[0]) dropped.add(i);
        for (const i of others) log.log(`Briefing ${label}: same news: "${clip(items[i].titleTranslation ?? items[i].title, 70)}" is among the angles of "${clip(items[keeper].titleTranslation ?? items[keeper].title, 70)}" (both readers agree)`);
    }
    return items.map((item, index) => dropped.has(index) ? null : placed.get(index) ?? item).filter(Boolean);
};

// The groups of cards of the briefing that tell the same news, both readers agreeing: [[index, ...]]. Never throws: a reader that fails, answers what
// cannot be read or takes too long leaves the cards as they are (nothing is folded on one reader's word). AI_CARD_MERGE=off switches it off
export const sameNewsGroups = async (items, language, {usage = null, label = 'unsaved', log = console} = {}) => {
    if (items.length < 2 || process.env.AI_CARD_MERGE === 'off') return [];
    const started = Date.now();
    let timer;
    try {
        const prompt = mergePrompt(items, language);
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        const [fast, slow] = await Promise.race([Promise.allSettled([
            ollamaJson(prompt, usage, {timeoutMs: FAST_TIMEOUT_MS}),
            ollamaJson(prompt, usage, {model: MERGE_MODEL, think: true, fallback: null, timeoutMs: SLOW_TIMEOUT_MS}),
        ]), late]);
        for (const [name, result] of [['the first reader', fast], ['the second reader', slow]]) {
            if (result.status === 'rejected') log.error(`Briefing ${label}: same news: ${name} did not answer (${result.reason?.message}), no card is folded`);
        }
        if (fast.status !== 'fulfilled' || slow.status !== 'fulfilled') return [];
        const first = normalizeGroups(fast.value, items.length), second = normalizeGroups(slow.value, items.length);
        const groups = agreedGroups(first, second);
        log.log(`Briefing ${label}: same news: ${first.length} groups by the first reader, ${second.length} by the second, ${groups.length} agreed, ${Math.round((Date.now() - started) / 1000)} s (tokens ${JSON.stringify(usage)})`);
        return groups;
    } catch (err) {
        log.error(`Briefing ${label}: same news: the cards were not read (${err.message})`);
        return [];
    } finally {
        clearTimeout(timer);
    }
};
