//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: briefing-analysis.js
//  Description: The analysis on top of a briefing, written by the AI from its cards only, once they are shown:
//               what changed (a line per card) and what could break next ("If X, then Y"). Every line cites
//               its cards, and the code drops a line whose figure or name none of them gives
//

"use strict"

import process from 'node:process';
import {writtenIn} from './language.js';
import {ollamaJson} from './ollama.js';
import {tagTexts, taggerUrls} from './tagger.js';

// Measured on 10 briefings of 7 profiles (bench/analysis-*.mjs, data/analysis/table.md, 15.10.2026),
// every line judged blind then read again: lines no cited card supports, per briefing, deepseek-v4-pro
// reasoning 0.25, without 0.40, gemma4:31b 0.40, kimi-k3 0.90; its What Changed lines tell more than
// the title 96% of the time (gemma 83%), 1.5 useful risks per briefing (gemma 1.0). It reasons 3 to 4
// minutes (181-247 s): the briefing is shown first, the analysis comes after. "Why This Matters" (what
// links the cards) was left out: every model wrote a theme on 50-80% of the briefings with no real link
export const ANALYSIS_MODEL = process.env.OLLAMA_ANALYSIS_MODEL || 'deepseek-v4-pro:0813';
const ANALYSIS_TIMEOUT_MS = 330e3;
// a card is read up to this long, its title and passages are what the reader sees of it
const CARD_PASSAGES = 1600;
const MAX_RISKS = 3;

const cardText = (card, n) => {
    const passages = (card.translation ?? card.summary).replace(/\n{2,}/g, '\n').slice(0, CARD_PASSAGES);
    return `[${n}] ${card.lead?.source ?? card.articles?.[0]?.source ?? 'unknown medium'}
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages${card.translation ? ' (translated)' : ''}:
${passages}`;
};

export const analysisPrompt = (cards, language) => `You write the opening analysis of a news briefing for one reader, in ${language}. You only have the
cards below: each is one news story, given by its number, its medium, its title and its key passages
(sentences copied from the article). You know nothing else: no background knowledge, no other news,
no guess.

Write two parts:

1. "changed": one line per card, in the order of the cards: the main new fact of that card in one
   sentence of at most 25 words: who did what, with the figure or date that matters when the card
   gives one. Tell something the title alone does not tell when the passages allow it. It cites its
   card.

2. "risks": what could happen next, as "If X, then Y", 0 to ${MAX_RISKS} entries. Both X and Y must be stated
   by the cited cards: a pending decision, a deadline, an announced vote or ruling, a threat, a
   warning, or a consequence someone in the card names. Never a consequence you imagine yourself,
   never an event, actor or place no cited card names. No such risk in the cards: an empty list.

For every line:
- every name (person, organisation, place, product), every figure and every date is in the cards it
  cites (a name may be translated);
- the certainty of the cards is kept: what is planned, alleged, likely, demanded or a rumour stays
  so, and what someone says stays said by them;
- no opinion and no advice of your own;
- the card numbers go in "cards" only, never in the text.

CARDS

${cards.map((card, i) => cardText(card, i + 1)).join('\n\n')}

Answer only in JSON, all text in ${language}:
{"changed": [{"cards": [1], "text": "..."}], "risks": [{"cards": [3], "if": "...", "then": "..."}]}`;

// The checks of the code, no AI (bench/analysis-checks.mjs): a line is dropped when it cites no card,
// when one of its figures is in none of its cited cards, or one of its names. Measured: 28 lines of
// 1030 dropped, the one invented by outside knowledge among them ("City face 115 charges"); errors of
// certainty, attribution or cause pass them, which no figure or name can show
const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, thousand: 1000,
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
    quinze: 15, vingt: 20, trente: 30, cinquante: 50, cent: 100, mille: 1000,
    first: 1, second: 2, third: 3, premier: 1, première: 1, deuxième: 2, troisième: 3,
};
const strip = (text) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
// the figures of a text, digits only, the zeros at their end left out: "1.2" and "1,200,000" are "12"
const figuresOf = (text) => ((text ?? '').match(/\d+(?:[.,   ]\d{3}(?!\d))*(?:[.,]\d+)?/g) ?? [])
    .map(figure => figure.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').replace(/0+$/, '') || '0');
// what the cards give that a line may write otherwise: "2 thousand 200" is 2200, "7 p.m." 19, the
// year 2020 of a season "2020-21" is "20", "five" is 5
const spelledThousands = (text) => [...(text ?? '').matchAll(/(\d+)\s+(?:thousand|mille|tysięcy|tysiące|mil)\s+(\d{1,3})\b/gi)]
    .map(match => String(Number(match[1]) * 1000 + Number(match[2])).replace(/0+$/, ''));
const afternoonHours = (text) => [...(text ?? '').matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*p\.?\s?m\b/gi)]
    .filter(match => Number(match[1]) < 12).map(match => `${Number(match[1]) + 12}${match[2] ?? ''}`.replace(/0+$/, ''));
const shortYears = (text) => ((text ?? '').match(/\b(?:19|20)\d{2}\b/g) ?? []).map(year => year.slice(2).replace(/^0(?=\d)/, '').replace(/0+$/, '') || '0');
const cardFigures = (text) => new Set([...figuresOf(text), ...spelledThousands(text), ...afternoonHours(text), ...shortYears(text),
    ...strip(text).split(' ').filter(word => word in NUMBER_WORDS).map(word => String(NUMBER_WORDS[word]).replace(/0+$/, ''))]);

// A name is in a text when the text holds it, or every word of it (the small words of names left
// aside), a word of 5 letters or more by its first 5 (a translated name: "Université de Houston" is
// "University of Houston"), a word in capitals (FA, ESA) by the initials of words of the text, a person
// by their last name
const NAME_GLUE = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'and', 'et', 'd', 'l', 'von', 'van', 'der', 'di', 'da']);
const holds = (haystack, name, label, acronyms) => {
    const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
        .map(word => ({word: strip(word), caps: /^\p{Lu}{2,6}$/u.test(word)})).filter(({word}) => word.length >= 2 && !NAME_GLUE.has(word));
    if (words.length === 0) return true;
    const padded = ` ${haystack} `;
    const has = ({word, caps}) => (caps && acronyms.has(word))
        || (word.length >= 5 ? padded.includes(` ${word.slice(0, 5)}`) : padded.includes(` ${word} `) || padded.includes(` ${word}s `));
    if (padded.includes(` ${words.map(({word}) => word).join(' ')} `) || words.every(has)) return true;
    const last = words.at(-1).word;
    return /person/i.test(label) && words.length > 1 && last.length >= 4 && padded.includes(` ${last} `);
};
const acronymsOf = (text) => {
    const tokens = (text ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const acronyms = new Set();
    for (let i = 0; i < tokens.length; i++) {
        let initials = '';
        for (let j = i; j < tokens.length; j++) {
            if (NAME_GLUE.has(tokens[j].toLowerCase()) && initials) continue;
            if (!/^\p{Lu}/u.test(tokens[j])) break;
            initials += strip(tokens[j][0]);
            if (initials.length >= 2) acronyms.add(initials);
        }
    }
    return acronyms;
};
// the tagger not answering: the words in capitals not starting a sentence are the names
const SENTENCE_START = /(^|[.!?:;→"«“(]\s*)$/;
const STOP = new Set(['if', 'then', 'the', 'a', 'an', 'this', 'that', 'si', 'alors', 'le', 'la', 'les', 'un', 'une', 'ce', 'cette', 'en', 'et', 'de', 'des', 'du', 'au', 'aux', 'il', 'elle', 'ils', 'elles', 'on']);
const capitalised = (text) => {
    const names = [];
    for (const match of text.matchAll(/[\p{Lu}][\p{L}\p{N}'’.-]*(?:\s+(?:de|du|des|la|le|van|von|der|di|da|of|and|&)?\s*[\p{Lu}][\p{L}\p{N}'’.-]*)*/gu)) {
        if (SENTENCE_START.test(text.slice(0, match.index)) && !/\s/.test(match[0])) continue;
        const name = match[0].replace(/[.’'-]+$/, '');
        if (!STOP.has(strip(name))) names.push({text: name, label: ''});
    }
    return names;
};
// the tagger tags common nouns too ("un utilisateur", "Spanish referees"): a name has a word in
// capitals that is no determiner, and does not end in a common noun
const NAME_LABELS = /person|organi[sz]ation|location|place|country|city|product|event|team|club|company/i;
const DETERMINERS = new Set([...STOP, 'l', 'd', 'several', 'some', 'many', 'most', 'certains', 'certaines', 'plusieurs', 'quelques',
    'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'their', 'its', 'his', 'her', 'former', 'new', 'nouveau', 'nouvelle']);
const isName = (entity) => entity.split(/[\s'’-]+/).some(word => /^\p{Lu}/u.test(word) && !DETERMINERS.has(strip(word)))
    && !/^\p{Ll}/u.test(entity.split(/\s+/).at(-1));

// the names of the lines, by the first tagger of NER_URL that answers; null when none does
const namesOf = async (texts) => {
    for (const url of taggerUrls()) {
        try {
            const entities = await tagTexts(url, texts);
            return entities.map(found => [...new Map((found ?? []).filter(entity => NAME_LABELS.test(entity.label) && isName(entity.text))
                .map(entity => [entity.text, entity])).values()]);
        } catch (err) {
            console.error(`Analysis: the tagger at ${url} failed (${err.message})`);
        }
    }
    return null;
};

// the AI often writes the words the page puts around a risk: "If there is X," and "then Y." are "there is
// X" and "Y."
const condition = (text) => String(text ?? '').trim().replace(/^(?:if|si|wenn|se|als)\s+/i, '').replace(/[,;:\s]+$/, '');
const consequence = (text) => String(text ?? '').trim().replace(/^(?:then|alors|dann|allora|dan|entonces)\s+/i, '');

const textOf = (card) => [card.title, card.titleTranslation, card.summary, card.translation].filter(Boolean).join('\n');

// The lines of an answer of the AI the checks keep, each citing the storyIds of its cards: {changed:
// [{text, storyIds}], risks: [{if, then, storyIds}], dropped}
export const checkedLines = async (answer, cards) => {
    const numbers = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && cards[n - 1]))];
    const list = (key) => Array.isArray(answer?.[key]) ? answer[key] : [];
    const lines = [
        ...list('changed').map(line => ({part: 'changed', cards: numbers(line?.cards), text: String(line?.text ?? '').trim()})),
        ...list('risks').slice(0, MAX_RISKS).map(line => ({part: 'risk', cards: numbers(line?.cards),
            if: condition(line?.if), then: consequence(line?.then)})),
    ].map(line => ({...line, text: line.part === 'risk' ? `${line.if} → ${line.then}` : line.text}))
        .filter(line => line.part === 'risk' ? line.if && line.then : line.text);
    const tagged = await namesOf(lines.map(line => line.text));
    const kept = lines.filter((line, i) => {
        if (line.cards.length === 0) return false;
        const cited = line.cards.map(n => textOf(cards[n - 1])).join('\n');
        const known = cardFigures(cited);
        if (figuresOf(line.text).some(figure => !known.has(figure))) return false;
        const citedText = strip(cited), acronyms = acronymsOf(cited);
        return (tagged?.[i] ?? capitalised(line.text)).every(name => holds(citedText, name.text, name.label, acronyms));
    });
    const storyIds = (line) => line.cards.map(n => cards[n - 1].storyId);
    return {
        changed: kept.filter(line => line.part === 'changed').map(line => ({text: line.text, storyIds: storyIds(line)})),
        risks: kept.filter(line => line.part === 'risk').map(line => ({if: line.if, then: line.then, storyIds: storyIds(line)})),
        dropped: lines.length - kept.length,
    };
};

// The analysis of the cards of a briefing (its items) for a reader of 'language' (a code): {status:
// 'ready', model, changed, risks, dropped}. When the model fails or gives no JSON, gemma4:31b writes it
// (14 s, no invented risk in the bench, fewer and plainer lines); null when there is no card to write from
export const analysisOf = async (items, language, usage = null) => {
    const cards = items.filter(item => item.summary);
    if (cards.length === 0) return null;
    const prompt = analysisPrompt(cards, writtenIn(language) ?? 'English');
    let model = ANALYSIS_MODEL;
    let answer = await ollamaJson(prompt, usage, {model, think: true, timeoutMs: ANALYSIS_TIMEOUT_MS}).catch(err => {
        console.error(`Analysis: ${ANALYSIS_MODEL} failed (${err.message}), gemma asked`);
        return null;
    });
    if (!answer) {
        model = null;
        answer = await ollamaJson(prompt, usage);
    }
    const lines = await checkedLines(answer, cards);
    return {status: 'ready', model: model ?? 'gemma4:31b', ...lines};
};
