//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: sport-check.js
//  Description: A card about another sport than the reader's is left out (the user, 12.11.2026, on a briefing of a reader of football refereeing with 3 cards of
//               basketball: "c'est un problème grave"). The AI that chooses the cards reads a title and a description in the language of the news, and
//               an acronym that looks alike from a sport to another is read as the one it knows: the Greek ΕΟΚ (the basketball federation) was written down as
//               "Greek Football Federation (EPO)", the ABA league (basketball) was chosen for its referees, and a rule about the sport added to the prompt
//               of the choice changed neither (bench/funnel-audit.mjs choose: 5 runs, the two cards chosen 5 times of 5 with it as without). The cards written
//               say it: the names Wikidata spells ("Hellenic Basketball Federation") and the text translated. They are read once more as a whole, with the
//               profile, and the AI says for each the sport of its main subject and the words of the card that show it. The AI proposes, the code decides:
//               a card is left out only when the sport is not one of the sports the profile follows AND the words quoted are in the card; a profile that follows
//               sport in general, a card of no sport in particular, a doubt, a failing call, a card the reader added: all keep the card
//
//  AI_SPORT_CHECK=off switches it off
//

"use strict"

import process from 'node:process';
import {ollamaJson} from './ollama.js';
import {withoutOriginalMarks, UNCHECKED} from './original-marks.js';

const TEXT_WORDS = 45;
const NAMES = 6;
const TIMEOUT_MS = 90e3;
const DEADLINE_MS = 120e3;

const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const clip = (text, n) => norm(text).split(' ').slice(0, n).join(' ');
const plain = (text) => withoutOriginalMarks(String(text ?? '')).replaceAll(UNCHECKED, '');

// The sport in one word: the writings of football are one, so are the ones of basketball. Null for "no sport", "unknown" and the like
const FOLDED = new Map([
    ['soccer', 'football'], ['association football', 'football'], ['football (soccer)', 'football'], ['football/soccer', 'football'], ['futsal', 'football'],
    ['beach soccer', 'football'], ['beach football', 'football'], ['fútbol', 'football'], ['calcio', 'football'], ['foot', 'football'],
    ['basket', 'basketball'], ['basket-ball', 'basketball'], ['basket ball', 'basketball'],
    ['us football', 'american football'], ['gridiron', 'american football'],
]);
const NOT_A_SPORT = new Set(['', 'none', 'null', 'unknown', 'n/a', 'na', 'no sport', 'unclear', 'general', 'politics', 'business']);
const EVERY_SPORT = new Set(['all', 'any', 'every', 'sport', 'sports', 'general', 'several']);
export const sportName = (value) => {
    const name = norm(value).toLowerCase().replace(/[.]$/, '');
    if (NOT_A_SPORT.has(name)) return null;
    return FOLDED.get(name) ?? name;
};

// What the AI is shown of a card, the card as the reader sees it: its title, the names it shows, the first words of its text translated
export const viewOf = (item) => ({
    title: norm(item.titleTranslation ?? item.title),
    names: (item.names ?? []).map(name => name.name).filter(Boolean).slice(0, NAMES),
    text: clip(plain(String(item.translation ?? item.summary ?? '').split(/\n\n/)[0]), TEXT_WORDS),
});

export const sportPrompt = (profileText, views) => `A reader wrote this profile of what he wants in his daily news:
"""${profileText}"""

1. "readerSports": the sports this profile follows, each in one or two words of English in lower case (football, basketball, tennis...). Football means association football (futsal and beach soccer too), with FIFA, UEFA and the confederations. If the profile follows sport in general, follows several sports without naming them, or you cannot tell, answer ["all"].

Here are the cards of his briefing as he will read them, written and translated, each with its number, its title, the people and organisations it names and the first words of its text:

${views.map((view, i) => `[${i + 1}] ${view.title}\n    names: ${view.names.join(', ') || '-'}\n    ${view.text}`).join('\n\n')}

2. For each card, "sport": the sport its MAIN subject belongs to (its federation, its league, its competition, its referees or its players), in the same words, or "none" when it is about no sport in particular (the policy or the law of sport in general, business, politics) or you cannot tell. A card that only mentions another sport in passing is not of that sport. A federation, a league or a competition of a sport is of that sport (a basketball federation, the ABA league, the NBA, the Euroleague, the ICC of cricket). When in doubt, "none". For a card of a sport that is not football, "evidence" quotes the words of the card (its title, its names or its text, exactly as written above) that show the sport; otherwise null.

Answer in JSON only: {"readerSports": ["..."], "cards": [{"id": 1, "sport": "...", "evidence": "..." or null}]}`;

// {sports: Set of the sports the profile follows, null when it follows them all or nothing says, cards: Map index (from 0) -> {sport, evidence}}
export const normalizeSports = (answer, count) => {
    const named = (Array.isArray(answer?.readerSports) ? answer.readerSports : []).map(sportName).filter(Boolean);
    const every = (Array.isArray(answer?.readerSports) ? answer.readerSports : []).some(one => EVERY_SPORT.has(norm(one).toLowerCase()));
    const cards = new Map();
    for (const card of Array.isArray(answer?.cards) ? answer.cards : []) {
        const index = Number(String(card?.id ?? '').replace(/^\[|\]$/g, '')) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= count || cards.has(index)) continue;
        cards.set(index, {sport: sportName(card?.sport), evidence: typeof card?.evidence === 'string' ? norm(card.evidence) : null});
    }
    return {sports: every || named.length === 0 ? null : new Set(named), cards};
};

// The cards of another sport than the profile's: Map index -> {sport, evidence}. Only the ones whose sport is not one the profile follows AND whose evidence is
// in what the AI was shown (a word it quotes that the card does not hold shows nothing): a doubt keeps the card
export const otherSports = (answer, views, {skip = new Set()} = {}) => {
    const {sports, cards} = normalizeSports(answer, views.length);
    const found = new Map();
    if (!sports) return found;
    for (const [index, {sport, evidence}] of cards) {
        if (!sport || sports.has(sport) || skip.has(index)) continue;
        const shown = `${views[index].title} ${views[index].names.join(' ')} ${views[index].text}`.toLowerCase();
        if (!evidence || evidence.length < 4 || !shown.includes(evidence.toLowerCase())) continue;
        found.set(index, {sport, evidence});
    }
    return found;
};

// [{storyId, title, sport, evidence}] of the cards written that are about another sport than the profile's. Never throws: a call that fails or does not answer in
// time gives none
export const wrongSportOf = async (items, profileText, {usage = null, label = 'unsaved', log = console} = {}) => {
    if (items.length === 0 || process.env.AI_SPORT_CHECK === 'off') return [];
    const started = Date.now();
    let timer;
    try {
        const views = items.map(viewOf);
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${DEADLINE_MS / 1e3} s`)), DEADLINE_MS); });
        // with reasoning: without it the ABA league of a list of referees was football 3 times of 3, with it basketball 3 of 3 (the two cards of the
        // Greek federation, whose names say it, were basketball both ways)
        const answer = await Promise.race([ollamaJson(sportPrompt(profileText, views), usage, {think: true, timeoutMs: TIMEOUT_MS}), late]);
        // a news the reader added by its link is his choice: never judged
        const skip = new Set(items.map((item, i) => item.imported ? i : -1).filter(i => i >= 0));
        const found = otherSports(answer, views, {skip});
        log.log(`Briefing ${label}: sport: the profile follows ${normalizeSports(answer, items.length).sports ? [...normalizeSports(answer, items.length).sports].join(', ') : 'every sport or none in particular'}, ${items.length} cards read, ${found.size} of another sport, ${Math.round((Date.now() - started) / 1000)} s`);
        return [...found].map(([index, one]) => ({storyId: items[index].storyId, title: views[index].title, ...one}));
    } catch (err) {
        log.error(`Briefing ${label}: sport: the cards were not read (${err.message})`);
        return [];
    } finally {
        clearTimeout(timer);
    }
};

// The cards without the ones of another sport, in their order
export const withoutOtherSport = (items, wrong, {label = 'unsaved', log = console} = {}) => {
    if (wrong.length === 0) return items;
    const gone = new Set(wrong.map(one => one.storyId));
    for (const one of wrong) log.log(`Briefing ${label}: sport: "${one.title.slice(0, 80)}" is left out, it is about ${one.sport} ("${one.evidence.slice(0, 80)}")`);
    return items.filter(item => !gone.has(item.storyId));
};
