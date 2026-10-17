//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: card-analysis.js
//  Description: The analysis of the cards of a briefing that merit one, written by the AI once the cards are
//               shown: the AI first picks the cards (an affair, a dispute, stakes the title does not tell, a
//               step to come), then writes for each why it matters and what may come next, from the card's
//               own sources only (its articles read whole, the earlier stories of its affair, its other
//               angles), every line citing them. The code drops a line whose figure or name its sources do
//               not give
//

"use strict"

import process from 'node:process';
import {writtenIn} from './language.js';
import {ollamaJson} from './ollama.js';
import {tagTexts, taggerUrls} from './tagger.js';
import {mapWithConcurrency} from './concurrency.js';

// Measured on the 139 cards of 10 briefings of 7 profiles (bench/card-analysis-*.mjs, data/card-analysis/
// table.md, 15.10.2026), every line judged blind then read again:
// - the choice, deepseek-v4-pro without reasoning: 1 to 4 plain news picked of about 50, 7-8 of 51 that
//   merit one missed (gemma4:31b: 7 plain news picked); about 5 s
// - the analysis, deepseek-v4-pro reasoning, with the rules of who says what and no link of cause the
//   sources do not make: a misleading line on 4-5 of 74 cards (the same rules without reasoning 20, the
//   first rules with reasoning 20-30, gemma 29), 70-78% worth showing; 71 s a card, up to 161 s
// No outside knowledge was found in any run. Gemma does not take its place: a failure is no analysis
export const ANALYSIS_MODEL = process.env.OLLAMA_ANALYSIS_MODEL || 'deepseek-v4-pro:0813';
const ANALYSIS_TIMEOUT_MS = 300e3;
// the cards written at once: Ollama takes 6 calls at once for the whole key (see ollama.js)
const CARDS_AT_ONCE = 3;
// what the choice reads of a card, and what the analysis reads of its articles: the lead first and at
// least LEAD_CHARS of it, OTHER_CHARS at most of each other article, CARD_CHARS in all
const TRIAGE_PASSAGES = 1600;
const CARD_CHARS = 12000;
const LEAD_CHARS = 6000;
const OTHER_CHARS = 3000;
const MAX_ARTICLES = 5;
export const TIMELINE_MAX = 12;
const MAX_WHY = 2;
const MAX_NEXT = 2;

// sentences kept while they fit in 'chars'
const fitted = (sentences, chars) => {
    const kept = [];
    let used = 0;
    for (const sentence of sentences) {
        if (used + sentence.length > chars && kept.length > 0) break;
        kept.push(sentence);
        used += sentence.length + 1;
    }
    return kept;
};
const size = (sentences) => sentences.reduce((n, sentence) => n + sentence.length + 1, 0);

// The articles of a card as the analysis reads them: [{source, title, publishedAt, sentences}], the lead
// first. articles: the ones read, the lead first, their sentences as published
export const fittedArticles = (articles) => {
    const [lead, ...others] = articles.slice(0, MAX_ARTICLES);
    if (!lead) return [];
    const kept = others.map(article => ({...article, sentences: fitted(article.sentences, OTHER_CHARS)}));
    const leadChars = Math.max(LEAD_CHARS, CARD_CHARS - kept.reduce((n, article) => n + size(article.sentences), 0));
    const fitting = [];
    let used = 0;
    for (const article of [{...lead, sentences: fitted(lead.sentences, leadChars)}, ...kept]) {
        if (fitting.length > 0 && used + size(article.sentences) > CARD_CHARS + 500) {
            const left = CARD_CHARS - used;
            if (left < 800) break;
            article.sentences = fitted(article.sentences, left);
        }
        used += size(article.sentences);
        fitting.push(article);
    }
    return fitting;
};

// A card as the prompts read it: {n, storyId, title, titleTranslation, medium, summary, translation,
// articles: [{source, title, publishedAt, sentences}], timeline: {days, items: [{date, title,
// titleTranslation, medium}]}, angles, contested, official}
const passagesOf = (card) => (card.translation ?? card.summary ?? '').replace(/\n{2,}/g, '\n');

const triageCard = (card) => {
    const days = card.timeline.days;
    return `[${card.n}] ${card.medium ?? 'unknown medium'}
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
History: ${days > 0 ? `earlier stories of this affair on ${days} earlier day${days > 1 ? 's' : ''}` : 'none found'}
Key passages${card.translation ? ' (translated)' : ''}:
${passagesOf(card).slice(0, TRIAGE_PASSAGES)}`;
};

export const triagePrompt = (cards, language) => `You choose which cards of a news briefing get a short analysis, for one reader. Each card is one news
story: its number, its medium, its title, its key passages (sentences copied from the article) and
whether earlier stories of the same affair were found on earlier days.

An analysis explains what the card alone does not: why the news matters, its stakes, how it fits an
affair, what comes next. Give one only to a card that merits it:
- its stakes are not visible in its title (a decision whose consequences the passages tell);
- it is part of an affair or a conflict, with or without earlier stories;
- it is disputed: an accusation, a denial, a criticism, a legal fight;
- it announces a next step: a vote, a trial, an appeal, a deadline, a threat, a decision to come;
- it rests on a mechanism worth explaining: a rule, a funding, a procedure, a law.
Give none to plain factual news that the title and passages tell in full: a match result, a routine
appointment, a referee designated, a product launch or update, a review, a schedule, a ranking.
Earlier stories alone are no reason: a series of match results is still plain news.
Picking no card is a good answer when none merits it; a forced pick is a wrong one.

CARDS

${cards.map(triageCard).join('\n\n')}

Answer only in JSON, the reasons in ${language}, at most 12 words each:
{"cards": [{"n": 3, "reason": "..."}]}`;

const day = (date) => date ? String(date).slice(0, 10) : 'undated';

// the sources of a card, each with the id its lines cite: A1 s12 = article 1 sentence 12, T3 = earlier
// story 3, G2 = other angle 2, D1 = denial 1, O1 = official source 1. The descriptions of Wikidata of
// the bench are left out: no line cited them
export const sourcesOf = (card) => {
    const sources = [];
    card.articles.forEach((article, i) => article.sentences.forEach((sentence, j) =>
        sources.push({id: `A${i + 1} s${j + 1}`, kind: 'article', text: sentence})));
    card.timeline.items.forEach((item, i) => sources.push({id: `T${i + 1}`, text: [item.title, item.titleTranslation].filter(Boolean).join(' / '), date: item.date}));
    card.angles.forEach((angle, i) => sources.push({id: `G${i + 1}`, text: [angle.title, angle.titleTranslation].filter(Boolean).join(' / '), date: angle.publishedAt}));
    card.contested.forEach((denial, i) => sources.push({id: `D${i + 1}`, text: [denial.sentence, denial.translation].filter(Boolean).join(' / ')}));
    card.official.forEach((post, i) => sources.push({id: `O${i + 1}`, text: `${post.party ?? ''}: ${post.title ?? ''}`, date: post.publishedAt}));
    return sources;
};

const sourcesText = (card) => {
    const parts = card.articles.map((article, i) => `ARTICLE A${i + 1}: ${article.source ?? 'unknown medium'}, ${day(article.publishedAt)}${i === 0 ? ' (the lead article of the card)' : ''}
Title: ${article.title}
${article.sentences.map((sentence, j) => `s${j + 1} ${sentence}`).join('\n')}`);
    if (card.timeline.items.length) parts.push(`TIMELINE: earlier stories of the same affair, oldest first (title only)
${card.timeline.items.map((item, i) => `T${i + 1} ${item.date} ${item.medium ?? ''}: ${item.title}${item.titleTranslation ? ` (translated: ${item.titleTranslation})` : ''}`).join('\n')}`);
    if (card.angles.length) parts.push(`OTHER ANGLES: other news of the same affair (title only)
${card.angles.map((angle, i) => `G${i + 1} ${day(angle.publishedAt)} ${angle.source ?? ''}: ${angle.title}${angle.titleTranslation ? ` (translated: ${angle.titleTranslation})` : ''}`).join('\n')}`);
    if (card.contested.length) parts.push(`DENIALS reported by the articles
${card.contested.map((denial, i) => `D${i + 1} ${denial.sentence}${denial.translation ? ` (translated: ${denial.translation})` : ''}`).join('\n')}`);
    if (card.official.length) parts.push(`OFFICIAL SOURCES: what a party of the news published itself (title only)
${card.official.map((post, i) => `O${i + 1} ${day(post.publishedAt)} ${post.party ?? ''}: ${post.title ?? ''}`).join('\n')}`);
    return parts.join('\n\n');
};

// the rules of round 2 of the bench: who says what, no link of cause or purpose the sources do not make,
// two "why" lines at most (a misleading line on 41% of the cards before them, 5-7% after)
export const analysisPrompt = (card, language) => `You write a short analysis of one news card for one reader, in ${language}. The reader already sees the
card: its title and its key passages (below). Your analysis tells what they do not: why the news
matters, what is at stake, how it fits the affair, what may come next. You only have the sources
below, each with an id. You know nothing else: no background knowledge, no other news, no guess.

THE CARD THE READER SEES
Title: ${card.title}${card.titleTranslation ? `\nTitle translated: ${card.titleTranslation}` : ''}
Key passages:
${passagesOf(card)}

SOURCES

${sourcesText(card)}

Write two parts:

1. "why": why this news matters, 1 or 2 lines of at most 30 words: its stakes, its consequences, the
   mechanism it rests on (a rule, a funding, a procedure), the dispute or the affair it is part of,
   as the sources tell them. A line only repeating the title or the key passages is useless: leave it
   out.

2. "next": what may come next, as "If X, then Y", 0 to 2 entries. Both X and Y are stated by the cited
   sources as a possible next step: a pending decision, a deadline, a vote, a trial, an appeal, a
   threat, a warning, or a consequence someone in the sources names. Never a consequence you imagine
   yourself, never two facts you join yourself. None in the sources: an empty list.

For every line:
- it cites the ids of the sources it relies on ("A1 s12", "T3", "G2"...), every one it uses;
- every name (person, organisation, place, product), every figure and every date is in the sources
  it cites (a name may be translated);
- every opinion, forecast, demand, accusation or claim is written with who says it ("X says...",
  "according to Y..."), never as a fact: a journalist, a columnist, a club, an expert or a company
  saying something is not the thing being true;
- no "so", "because", "therefore", "in order to", "which means" or other link of cause, consequence or
  purpose unless a cited source states that very link; two facts side by side stay two facts;
- the certainty of the sources is kept: what is planned, alleged, likely, demanded or a rumour stays
  so ("may" stays "may", never "will");
- a timeline or angle title only tells that such a news was published, not that it is true;
- no opinion and no advice of your own;
- the ids go in "cites" only, never in the text.
Nothing beyond the card in the sources: answer empty lists. An empty answer is a good answer; a line
padded out of the card is a wrong one.

Answer only in JSON, all text in ${language}:
{"why": [{"text": "...", "cites": ["A1 s3", "T2"]}], "next": [{"if": "...", "then": "...", "cites": ["A2 s7"]}]}`;

// The checks of the code, no AI (bench/card-analysis-checks.mjs): a line is dropped when it cites no
// source of its card, or one of its figures, or one of its names, is in none of its cited sources (a
// cited sentence counts with its whole article, its medium, title and date). Measured: they catch few
// of the misleading lines, which slip on who says what or on certainty, and drop some right ones
// (translated names): one name missing from the cited sources passes when another source of the card
// has it (5 of 12 drops of round 2 were such names)
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
// what the sources give that a line may write otherwise: "2 thousand 200" is 2200, "7 p.m." 19, the
// year 2020 of a season "2020-21" is "20", "five" is 5
const spelledThousands = (text) => [...(text ?? '').matchAll(/(\d+)\s+(?:thousand|mille|tysięcy|tysiące|mil)\s+(\d{1,3})\b/gi)]
    .map(match => String(Number(match[1]) * 1000 + Number(match[2])).replace(/0+$/, ''));
const afternoonHours = (text) => [...(text ?? '').matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*p\.?\s?m\b/gi)]
    .filter(match => Number(match[1]) < 12).map(match => `${Number(match[1]) + 12}${match[2] ?? ''}`.replace(/0+$/, ''));
const shortYears = (text) => ((text ?? '').match(/\b(?:19|20)\d{2}\b/g) ?? []).map(year => year.slice(2).replace(/^0(?=\d)/, '').replace(/0+$/, '') || '0');
const knownFigures = (text) => new Set([...figuresOf(text), ...spelledThousands(text), ...afternoonHours(text), ...shortYears(text),
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
    if (texts.length === 0) return [];
    for (const url of taggerUrls()) {
        try {
            const entities = await tagTexts(url, texts);
            return entities.map(found => [...new Map((found ?? []).filter(entity => NAME_LABELS.test(entity.label) && isName(entity.text))
                .map(entity => [entity.text, entity])).values()]);
        } catch (err) {
            console.error(`Card analysis: the tagger at ${url} failed (${err.message})`);
        }
    }
    return null;
};

// the ids a line cites, read leniently: "A1 s12", "[A1 s12]", "A1 s12-14", "T3"
const parseCites = (cites) => {
    const ids = [];
    for (const raw of Array.isArray(cites) ? cites : typeof cites === 'string' ? cites.split(/[,;]/) : []) {
        const text = String(raw).replace(/[[\]]/g, '').trim();
        const sentence = text.match(/^A(\d+)\s*,?\s*s(\d+)(?:\s*[-–]\s*s?(\d+))?$/i);
        if (sentence) {
            for (let s = Number(sentence[2]); s <= Number(sentence[3] ?? sentence[2]) && s - Number(sentence[2]) < 30; s++) ids.push(`A${sentence[1]} s${s}`);
            continue;
        }
        const other = text.match(/^([TGDO])\s*(\d+)$/i);
        ids.push(other ? `${other[1].toUpperCase()}${other[2]}` : text);
    }
    return [...new Set(ids)];
};

// A line as the reader sees it: the ids the AI still writes in its text taken out when between
// parentheses ("(A1 s3, s4)"), an article left in the text named by its medium ("A1 says" -> "goal.com
// says"); a "next" without the "If" and "then" the page puts around X and Y
export const shownText = (card, text) => String(text ?? '')
    .replace(/\s*\((?:[^()]*\b(?:A\d+|s\d+|[TGDO]\d+)\b[^()]*)\)/g, '')
    .replace(/\bA(\d+)(?:\s*,?\s*s\d+(?:\s*[-–]\s*s?\d+)?)?\b/g, (id, n) => card.articles[Number(n) - 1]?.source ?? id)
    .replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim();
const condition = (text) => String(text ?? '').trim().replace(/^(?:if|si|wenn|se|als)\s+/i, '').replace(/[,;:\s]+$/, '');
const consequence = (text) => String(text ?? '').trim().replace(/^(?:then|alors|dann|allora|dan|entonces)\s+/i, '');

// The lines of an answer the checks keep, as shown: {why: ['...'], next: [{if, then}], dropped}
export const checkedLines = async (answer, card) => {
    const sources = new Map(sourcesOf(card).map(source => [source.id, source]));
    // a cited sentence with its article's medium, title and date (the lines say who says what:
    // "according to goal.com"), the other sources with their date
    const citedText = (id) => {
        const source = sources.get(id);
        if (source.kind !== 'article') return `${day(source.date)}\n${source.text}`;
        const article = card.articles[Number(id.match(/^A(\d+)/)[1]) - 1];
        return `${article.source ?? ''}\n${article.title}\n${day(article.publishedAt)}\n${source.text}`;
    };
    const every = [...sources.keys()].map(citedText).join('\n');
    const list = (key, max) => (Array.isArray(answer?.[key]) ? answer[key] : []).slice(0, max);
    const lines = [
        ...list('why', MAX_WHY).map(line => ({part: 'why', cites: parseCites(line?.cites), text: shownText(card, line?.text)})),
        ...list('next', MAX_NEXT).map(line => ({part: 'next', cites: parseCites(line?.cites),
            if: shownText(card, condition(line?.if)), then: shownText(card, consequence(line?.then))}))
            .map(line => ({...line, text: line.if && line.then ? `${line.if} → ${line.then}` : ''})),
    ].filter(line => line.text);
    const tagged = await namesOf(lines.map(line => line.text));
    const kept = lines.filter((line, i) => {
        const valid = line.cites.filter(id => sources.has(id));
        if (valid.length === 0) return false;
        // a cited sentence stands for its whole article: the actor is often named in the sentence before
        const articles = new Set(valid.filter(id => id.startsWith('A')).map(id => id.split(' ')[0]));
        const cited = [...sources.keys()].filter(id => valid.includes(id) || articles.has(id.split(' ')[0])).map(citedText).join('\n');
        const figures = knownFigures(cited);
        if (figuresOf(line.text).some(figure => !figures.has(figure))) return false;
        // a medium named by its own name ("Onze Mondial" for onzemondial.com) is found in its address
        const media = [...articles].map(id => strip(card.articles[Number(id.slice(1)) - 1]?.source).replace(/ /g, ''));
        const isMedium = (name) => {
            const word = strip(name).replace(/ /g, '');
            return word.length >= 4 && media.some(medium => medium.includes(word));
        };
        const citedStrip = strip(cited), acronyms = acronymsOf(cited);
        const missing = (tagged?.[i] ?? capitalised(line.text)).filter(name => !holds(citedStrip, name.text, name.label, acronyms) && !isMedium(name.text));
        return missing.length === 0 || (missing.length === 1 && holds(strip(every), missing[0].text, '', acronymsOf(every)));
    });
    return {
        why: kept.filter(line => line.part === 'why').map(line => line.text),
        next: kept.filter(line => line.part === 'next').map(line => ({if: line.if, then: line.then})),
        dropped: lines.length - kept.length,
    };
};

// The cards of a briefing that merit an analysis, by their number: [{n, reason}], [] when none does. No
// limit (the user, 15.10.2026): a card costs about $0.015 of the prepaid credits of Ollama, a 25-card
// briefing of affairs had 12 picked
export const pickedCards = async (cards, language, usage = null) => {
    const answer = await ollamaJson(triagePrompt(cards, writtenIn(language) ?? 'English'), usage, {model: ANALYSIS_MODEL, think: false});
    const picked = new Map();
    for (const entry of Array.isArray(answer?.cards) ? answer.cards : []) {
        const n = Number(entry?.n ?? entry);
        if (Number.isInteger(n) && cards[n - 1] && !picked.has(n)) picked.set(n, {n, reason: String(entry?.reason ?? '').trim() || null});
    }
    return [...picked.values()];
};

// The analysis of one card in the reader's language (a name): {why, next, dropped}, null when the AI
// failed or wrote nothing the checks keep
export const analysisOfCard = async (card, language, usage = null) => {
    const answer = await ollamaJson(analysisPrompt(card, language), usage, {model: ANALYSIS_MODEL, think: true, timeoutMs: ANALYSIS_TIMEOUT_MS});
    const lines = await checkedLines(answer, card);
    return lines.why.length + lines.next.length > 0 ? lines : null;
};

// The analyses of the cards (see the card above, numbered n from 1) for a reader of 'language' (a code):
// {picked: [{storyId, reason}], cards: {storyId: {why, next, dropped}}}. onPicked(picked) is called once
// the cards are chosen, before they are written; a card the AI fails on has none
export const analysesOf = async (cards, language, {usage = null, onPicked = async () => {}, onCard = async () => {}} = {}) => {
    const reader = writtenIn(language) ?? 'English';
    const picked = (await pickedCards(cards, language, usage)).map(({n, reason}) => ({card: cards[n - 1], reason}));
    await onPicked(picked.map(({card, reason}) => ({storyId: card.storyId, reason})));
    // onCard() after each card, written or not: the analysis still runs (see analysisOfRow in briefing-service.js)
    const written = await mapWithConcurrency(picked, CARDS_AT_ONCE, ({card}) => analysisOfCard(card, reader, usage)
        .finally(() => onCard().catch(() => {})));
    const analyses = {};
    written.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) analyses[picked[i].card.storyId] = result.value;
        else if (result.status === 'rejected') console.error(`Card analysis: card ${picked[i].card.storyId} not written (${result.reason?.message})`);
    });
    return {picked: picked.map(({card, reason}) => ({storyId: card.storyId, reason})), cards: analyses};
};
