//
//  Author: Fabian Rostello
//  Date: 05.10.2026
//  File: contested.js
//  Description: "Contested": a sentence of one of the articles of a card saying that someone named
//               denies its news, quoted word for word. Nobody is said to be right
//

"use strict"

import {languageOf, writtenIn} from './language.js';
import {sentencesOf, translateTexts} from './extract.js';
import {ollamaJson} from './ollama.js';

// Measured on the 100 stories of politics and world news and 97 cards of briefings of 2 media or more
// (bench/contested-versions.mjs): 22 cards would carry it, 21 right (Iran denying any role in the
// incident, Bardella's camp contesting the messages, Manchester City denying any wrongdoing), one
// sentence of a journalist read as a denial. Comparing what the articles say failed instead: pairs of
// sentences 40% right, the facts of each article 0 found, "another version" 35% (the same value in
// two writings, 47% and 47.06%, "6-0" and "0-6", given as two). A denial is said by the article
// itself, so the AI only has to read it, about 300 tokens a card.
const MAX_CANDIDATES = 25;          // sentences with a verb of denial read by the AI, the lead's first
const MAX_SHOWN = 2;                // denials shown on a card, of two different deniers

// the words of a denial, as a whole word: \b does not know the accented letters ("nié")
const word = (pattern) => String.raw`(?<![\p{L}\p{N}])(?:${pattern})`;
const end = String.raw`(?![\p{L}\p{N}])`;
// A sentence without one is never read as a denial: the wrong ones of the facts compared had none.
// Each language's words only in an article of that language: the Spanish "dispute" (plays) and the
// French "nie" of a name passed for English and Spanish words; all of them when the language is unknown
const WORDS = {
    en: [word(String.raw`den(?:y|ies|ied|ying|ial|ials)`) + end, word('refut'), word('rebut'), word(String.raw`disput(?:e|es|ed|ing)`) + end,
        word('baseless') + end, word('unfounded') + end, word(String.raw`reject(?:s|ed|ing)?`) + String.raw`.{0,40}(?:claim|accusation|allegation|report|charge)`],
    fr: [word('dément'), word('démenti'), word(String.raw`ni(?:e|ent|ait|aient|é|ée|és|ées)`) + end, word(String.raw`contest(?:e|ent|é|ée|ait|aient)`) + end,
        word('récus'), word('réfut'), word('rejet') + String.raw`\p{L}*.{0,40}(?:accusation|affirmation|allégation)`, word('infondé'), 'sans fondement'],
    es: [word(String.raw`nieg(?:a|an|o)`) + end, word(String.raw`neg(?:ó|aron|ado)`) + end, word('desmient'), word('desmint'),
        word('rechaz') + String.raw`\p{L}*.{0,40}(?:acusaci|afirmaci)`, word('infundad')],
    de: [word('dementi'), word('bestreit'), word('bestritt'), word('(?:weist|wies|wiesen)') + String.raw`.{0,60}zurück`, word('haltlos')],
    it: [word('smenti'), word(String.raw`neg(?:a|ano|ato)`) + end, word('respin') + String.raw`\p{L}*.{0,40}accus`, word('infondat')],
};
const DENIALS = Object.fromEntries(Object.entries(WORDS).map(([language, words]) => [language, new RegExp(words.join('|'), 'iu')]));
const ANY_DENIAL = new RegExp(Object.values(WORDS).flat().join('|'), 'iu');

// whether a sentence has a verb of denial; language: of its article, a code ('en', 'fr'...)
export const hasDenial = (sentence, language = null) => (DENIALS[language] ?? ANY_DENIAL).test(sentence);

const prompt = (title, candidates) => `A news card: "${title}"

Sentences of articles on it, each with a verb of denial:
${candidates.map((candidate, i) => `[${i + 1}] (${candidate.source}) ${candidate.sentence}`).join('\n')}

For each sentence, in this order:
denied_by: who denies, disputes or rejects something, in English, by their name: "Manchester City", not
  "the club" or "he", when the card or the sentence tells who it is; "" when nobody named does.
claim: what they deny, in a few words.
self: true when that claim is about them or about what they did (an accusation, a charge, a report on
  them); false when they contest someone else's view, version, decision or claim about another.
about: "main" when that claim is the news of the card itself, as its title tells it; "side" for
  anything else the article mentions: background, an older affair, another person's case.
denial: true when the sentence reports such a denial as a fact. Not a denial: "did not deny", someone
  who "denied" a request, a refusal, an opinion, a criticism, a journalist's own analysis, a word that
  only looks like a denial in another language (Spanish "disputar" is to play, to contest a match).
Answer in JSON only: {"sentences": [{"n": 1, "denied_by": "who", "claim": "what", "self": true, "about": "main", "denial": true}]}`;

// The denials of a card's news, from the articles read: texts [{source, url, publishedAt, page}],
// the lead first, page as read ({content, blocks}). language: the reader's, a quote in another one
// gets a machine translation. Answers [{by, sentence, translation, source, url, publishedAt}], empty
// when none of them reports a denial; the AI is only asked when a sentence has a verb of denial
export const contestedOf = async (title, texts, {language = 'en', usage = null} = {}) => {
    const seen = new Set();
    const candidates = texts.flatMap(text => {
        // the language of the article: one sentence is too short to tell it
        const written = languageOf(text.page.content);
        const found = sentencesOf(text.page).filter(sentence => hasDenial(sentence.text, written) && !seen.has(sentence.text) && seen.add(sentence.text));
        return found.map(sentence => ({sentence: sentence.text, source: text.source, url: text.url,
            publishedAt: text.publishedAt ?? null, language: written}));
    }).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return [];

    const answer = await ollamaJson(prompt(title, candidates), usage);
    const deniers = new Set();
    const shown = [];
    for (const read of Array.isArray(answer?.sentences) ? answer.sentences : []) {
        const candidate = candidates[Number(read?.n) - 1];
        const by = typeof read?.denied_by === 'string' ? read.denied_by.trim() : '';
        if (!candidate || read.denial !== true || read.self !== true || read.about !== 'main' || !by || deniers.has(by.toLowerCase())) continue;
        deniers.add(by.toLowerCase());
        shown.push({by, ...candidate});
        if (shown.length === MAX_SHOWN) break;
    }

    // the quotes in another language than the reader's translated, as the passages are
    const foreign = shown.filter(denial => denial.language && denial.language !== language && writtenIn(denial.language) && writtenIn(language));
    const translations = foreign.length === 0 ? [] : await translateTexts(foreign.map(denial => ({text: denial.sentence, from: writtenIn(denial.language)})),
        writtenIn(language), usage).catch(() => foreign.map(() => null));
    return shown.map(denial => ({...denial, translation: translations[foreign.indexOf(denial)] ?? null}));
};
