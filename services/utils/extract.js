//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: extract.js
//  Description: The key passages of an article, in its own words: the AI only gives the numbers of
//               the sentences to show, the code shows them word for word. A translation, marked
//               as such, is added when the article is not in the language of the reader
//

"use strict"

import {TOPICS, isTopic} from './topics.js';
import {languageOf, writtenIn} from './language.js';
import {ollamaJson} from './ollama.js';

// Summaries written by the AI changed what the article says in 4 of 30 articles, 3 of them again in
// a second run (a cause it never gives, a certainty turned around, the words of one person given to
// others), and 0 of 30 once told four rules against it, which leaves minor slips. A news service
// can't show that, so the AI writes nothing any more: it picks sentences, shown as published.
const MAX_CONTENT_CHARS = 12000;    // longer articles are cut, the start of a news holds the main information
const MAX_SENTENCES = 80;           // numbered for the AI, after that it is the end of a long article
const MIN_SENTENCE_WORDS = 4;       // under this, a caption or a menu item rather than a sentence
const MAX_SENTENCE_WORDS = 90;      // over this, text glued without punctuation (a list, a page)
const MAX_PICKED = 5;
const MAX_EXTRACT_WORDS = 170;
// Under this a page gave its first lines only (a teaser, a paywall): not enough to tell the news
const MIN_TEXT_WORDS = 60;

// who the article credits for what it reports, asked in the same call as the sentences
export const SOURCINGS = ['named', 'anonymous', 'none'];

const wordCount = (text) => (text ?? '').split(/\s+/).filter(Boolean).length;
export const canSummarize = (text) => wordCount(text) >= MIN_TEXT_WORDS;

const segmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
// "M.", "Mr.", "Dr.", "U.S.", "St.", "Guild v.": a sentence does not end there
const ABBREVIATION = /(?:^|[\s(])(?:[A-Za-z]|[A-Z][a-z]{1,2}|Mme|Mlle|Mgr|n°|No|vs|etc|(?:[A-Z]\.)+[A-Z])\.\s*$/;

// the sentences of a text, as written, whitespace put back to single spaces
const cut = (text) => {
    // pages read often glue sentences: "…les Bleus.Toute l'actualité" is two sentences
    const spaced = (text ?? '').replace(/([\p{Ll}\d)»"”’])([.!?])(?=[\p{Lu}«"“])/gu, '$1$2 ');
    const sentences = [];
    for (const {segment} of segmenter.segment(spaced)) {
        const sentence = segment.replace(/\s+/g, ' ').trim();
        if (!sentence) continue;
        const previous = sentences.at(-1);
        // a closing quote, a lower case start or a figure closing a parenthesis ("8972), but") continue
        // the sentence before, as does an abbreviation. A straight quote opens as often as it closes:
        // it continues the sentence before only when no word follows it
        if (previous !== undefined && (/^[»”’)\]]|^"(?!\p{L})|^\p{Ll}|^\d+\)/u.test(sentence) || ABBREVIATION.test(previous))) {
            sentences[sentences.length - 1] = `${previous} ${sentence}`;
        } else {
            sentences.push(sentence);
        }
    }
    return sentences;
};
const isSentence = (text) => {
    const words = wordCount(text);
    return words >= MIN_SENTENCE_WORDS && words <= MAX_SENTENCE_WORDS;
};

// the sentences of a text read flat, when the page gave no blocks
export const splitSentences = (text) => cut((text ?? '').slice(0, MAX_CONTENT_CHARS)).filter(isSentence).slice(0, MAX_SENTENCES);

// The sentences that can be shown, from the blocks of the page: [{text, quote}]. Headings and
// captions are never shown; a sentence of a quote is marked, the reader sees it between quotation
// marks. The flat text is used when the blocks hold too little of it (a page set in divs)
export const sentencesOf = ({content, blocks}) => {
    const inBlocks = (blocks ?? []).filter(block => block.kind === 'text' || block.kind === 'quote');
    if (wordCount(inBlocks.map(block => block.text).join(' ')) < wordCount(content) / 2) {
        return splitSentences(content).map(text => ({text, quote: false}));
    }
    const sentences = [];
    let chars = 0;
    for (const block of inBlocks) {
        if (chars > MAX_CONTENT_CHARS) break;
        chars += block.text.length;
        for (const text of cut(block.text)) {
            if (isSentence(text)) sentences.push({text, quote: block.kind === 'quote'});
        }
    }
    return sentences.slice(0, MAX_SENTENCES);
};

// The passages shown: the sentences picked, the most important first, kept while they fit in the
// length of a card, then set back in the order of the article. Sentences that follow each other make
// one passage; a gap between two passages is shown to the reader. sentences: [{text, quote}];
// returns [[{text, quote}, ...], ...]
export const buildExtract = (sentences, picked) => {
    const kept = [];
    let words = 0;
    for (const number of [...new Set((picked ?? []).filter(Number.isInteger))]) {
        const sentence = sentences[number - 1];
        if (sentence === undefined || kept.length >= MAX_PICKED) continue;
        if (kept.length > 0 && words + wordCount(sentence.text) > MAX_EXTRACT_WORDS) continue;
        kept.push(number);
        words += wordCount(sentence.text);
    }
    const passages = [];
    let last = null;
    for (const number of kept.sort((a, b) => a - b)) {
        if (last !== null && number === last + 1) passages.at(-1).push(sentences[number - 1]);
        else passages.push([sentences[number - 1]]);
        last = number;
    }
    return passages;
};

const extractPrompt = (title, sentences) => `You pick the sentences of a news article that tell its news best. You never write
the news yourself: the sentences you pick are shown to the reader word for word, as the article
published them.
Rules:
- Pick 2 to ${MAX_PICKED} sentences, the most important first, that together say who did what, when and
  where, and the main figures. Fewer for a short article.
- Prefer sentences that make sense on their own. A sentence saying "he", "she", "it" or "this" without
  saying who or what is only picked with the sentence before it that says it.
- A sentence marked (quote) is someone's words quoted by the article: only pick it with a sentence
  that says who said it, never as what the article itself says.
- Never pick text that is not the news: ads, cookies, subscriptions, "read also", captions, credits,
  author lines, comments.
- An opinion piece, a blog post or an analysis is picked like a news: its main points. Only a page
  with no text of its own (ads, cookies, a video without text) gets an empty list.
- topic is the main subject, one of: ${TOPICS.join(', ')}. A news about a sport, a team, an athlete,
  a match or a referee is always sport.
- sourcing says who the article credits for what it reports: named (it names them: a person, a club,
  an institution, an official statement), anonymous (sources it does not name, "sources close to"),
  none (it credits nobody). It describes the article, never whether the news is true.

TITLE: ${title}

SENTENCES:
${sentences.map((sentence, i) => `[${i + 1}]${sentence.quote ? ' (quote)' : ''} ${sentence.text}`).join('\n')}

Answer only in JSON: {"topic": "...", "sourcing": "...", "sentences": [numbers of the sentences, the most important first]}`;

// a time of the 12-hour clock written on the 24-hour one, as a translation may: "7 p.m." is "19",
// "7:30 pm" is "19:30" and "12 a.m." is "0"
const twentyFourHours = (text) => text.replace(/\b(\d{1,2})(?:[:.](\d{2}))?[\s\u00a0\u202f]?([ap])\.?m\.?(?![a-z])/gi,
    (time, hour, minutes, half) => {
        if (+hour < 1 || +hour > 12) return time;
        const hours = +hour % 12 + (half.toLowerCase() === 'p' ? 12 : 0);
        return minutes ? `${hours}:${minutes}` : `${hours}`;
    });
// the figures of a sentence, whatever their separators: "1.1383" and "1,1383", "1,000" and "1 000" are
// the same figure, "September 21, 2026" two of them, and "7 p.m." the same as "19h00"
const figures = (text) => (twentyFourHours(text).match(/\d+(?:[.,   ]\d{3}(?!\d))*(?:[.,]\d+)?/g) ?? [])
    .map(figure => figure.replace(/[^\d]/g, ''));
// a translation keeps every figure of the sentence it translates, checked here rather than trusted
export const keepsFigures = (original, translation) => {
    const left = figures(translation);
    return figures(original).every(figure => {
        const i = left.indexOf(figure);
        if (i < 0) return false;
        left.splice(i, 1);
        return true;
    });
};

const translatePrompt = (sentences, from, to) => `Translate these sentences of a news article from ${from} into ${to}.
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. Names of
people, organisations and places stay as they are.

${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per sentence, in the same order]}`;

// The passages translated sentence by sentence, or null when a translation drops a figure or does
// not answer one per sentence: asked once more, then the reader gets the original only
export const translatePassages = async (passages, from, to, usage = null) => {
    const sentences = passages.flat().map(sentence => sentence.text);
    for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await ollamaJson(translatePrompt(sentences, from, to), usage).catch(() => null);
        const translations = answer?.translations;
        if (!Array.isArray(translations) || translations.length !== sentences.length) continue;
        if (!translations.every((translation, i) => typeof translation === 'string' && translation.trim()
            && keepsFigures(sentences[i], translation))) continue;
        let next = 0;
        return passages.map(passage => passage.map(sentence => ({text: translations[next++].trim(), quote: sentence.quote})));
    }
    return null;
};

// The language of passages and their translation for a reader of 'language' (a code), null when they
// are in that language already or could not be translated safely: {from, translation}
export const translationFor = async (passages, language, usage = null, fallback = null) => {
    const from = languageOf(passages.flat().map(sentence => sentence.text).join(' '), fallback);
    const translation = passages.length > 0 && from && from !== language && writtenIn(from) && writtenIn(language)
        ? await translatePassages(passages, writtenIn(from), writtenIn(language), usage)
        : null;
    return {from, translation};
};

// The key passages of an article for a reader of 'language' (a code: 'fr', 'en'...). page: the page
// read ({content, blocks}). Returns {passages, translation, from, topic, sourcing}: passages as
// published, translation null when the article is in the language of the reader or could not be
// translated safely; passages empty when the page has no text of its own
export const extractArticle = async (title, page, {language = 'en', usage = null} = {}) => {
    const sentences = sentencesOf(page);
    if (sentences.length === 0) return {passages: [], translation: null, from: null, topic: null, sourcing: null};

    const answer = await ollamaJson(extractPrompt(title, sentences), usage);
    const passages = buildExtract(sentences, answer?.sentences);
    const {from, translation} = await translationFor(passages, language, usage, languageOf(page.content));

    return {
        passages,
        translation,
        from,
        topic: isTopic(answer?.topic?.toLowerCase?.()) ? answer.topic.toLowerCase() : null,
        sourcing: SOURCINGS.includes(answer?.sourcing?.toLowerCase?.()) ? answer.sourcing.toLowerCase() : null,
    };
};

// the text kept in the cache and sent to the reader: one paragraph per passage (a gap between two of
// them), a quote between quotation marks
export const passagesText = (passages) => passages?.length
    ? passages.map(passage => passage.map(({text, quote}) => quote ? `“${text}”` : text).join(' ')).join('\n\n')
    : null;
