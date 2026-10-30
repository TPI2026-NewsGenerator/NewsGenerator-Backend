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
import {languageOf, ownLanguage, writtenIn} from './language.js';
import {ollamaJson} from './ollama.js';
import {ORIGINAL_END, ORIGINAL_START, withoutOriginalMarks} from './original-marks.js';

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
        // a dash or a bullet left of a dateline ("Zurich, 27 October 2026 —- The IFAB's...") is no part of it
        const sentence = segment.replace(/\s+/g, ' ').trim().replace(/^[\p{Pd}−•·*\s]+/u, '');
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

// the numbers of the sentences picked, the most important first, kept while they fit in the length of
// a card: the ones the article does not have and repeated ones left out
const keptOf = (sentences, picked) => {
    const kept = [];
    let words = 0;
    for (const number of [...new Set((picked ?? []).filter(Number.isInteger))]) {
        const sentence = sentences[number - 1];
        if (sentence === undefined || kept.length >= MAX_PICKED) continue;
        if (kept.length > 0 && words + wordCount(sentence.text) > MAX_EXTRACT_WORDS) continue;
        kept.push(number);
        words += wordCount(sentence.text);
    }
    return kept;
};

// sentences set back in the order of the article, the ones that follow each other as one passage
const passagesOf = (sentences, numbers) => {
    const passages = [];
    let last = null;
    for (const number of [...numbers].sort((a, b) => a - b)) {
        if (last !== null && number === last + 1) passages.at(-1).push(sentences[number - 1]);
        else passages.push([sentences[number - 1]]);
        last = number;
    }
    return passages;
};

// The passages shown: the sentences picked, the most important first, kept while they fit in the
// length of a card, then set back in the order of the article. Sentences that follow each other make
// one passage; a gap between two passages is shown to the reader. sentences: [{text, quote}];
// returns [[{text, quote}, ...], ...]
export const buildExtract = (sentences, picked) => passagesOf(sentences, keptOf(sentences, picked));

// The two shorter ways the reader can read a card in, made of the same sentences as published, never
// written by the AI. Measured on 30 articles (bench/formats-run.mjs, formats-pieces.mjs, 12.10.2026):
// points and summaries written by the AI changed the meaning of 2 or 3 of them, pieces cut out of
// sentences 1 to 3 (a cut drops "for takeoff and landing", "the message is"), whole sentences none.
// points: the most important sentences, one passage each, the most important first. digest: the most
// important ones while they fit 5 to 6 lines of a card, in the order of the article
const MAX_POINTS = 3;
const MAX_DIGEST_WORDS = 65;
export const shorterWays = (sentences, picked) => {
    const kept = keptOf(sentences, picked);
    const digest = [];
    let words = 0;
    for (const number of kept) {
        const count = wordCount(sentences[number - 1].text);
        if (digest.length > 0 && words + count > MAX_DIGEST_WORDS) continue;
        digest.push(number);
        words += count;
    }
    return {points: kept.slice(0, MAX_POINTS).map(number => [sentences[number - 1]]), digest: passagesOf(sentences, digest)};
};

export const extractPrompt = (title, sentences) => `You pick the sentences of a news article that tell its news best. You never write
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
// digits of the scripts we read written as ours, and their separators: Arabic-Indic and Persian digits are
// 0-9, their decimal and thousands marks "." and ","
const ourDigits = (text) => text
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 0xF))
    .replace(/(\d)\u066b(?=\d)/g, '$1.').replace(/(\d)\u066c(?=\d)/g, '$1,');
// a time written 18:30 is the one of 18.30 and of 6:30 p.m., a round "1/8-finals" the "round of 16" (measured
// on the cards of 30.10.2026: these made a translation or an AI version of 8 cards in 46 refused with
// nothing wrong in them)
const sameWrittenFigures = (text) => ourDigits(twentyFourHours(text))
    // 20h15, 20:15 and 20.15 are one time, 19h00 and 19:00 the hour alone, as the 12-hour clock gives it
    .replace(/\b([01]?\d|2[0-3])(?:[\s ]?h[\s ]?|:|\.)(00|[0-5]\d)\b/gi, (time, hour, minutes) => minutes === '00' ? hour : `${hour}.${minutes}`)
    // "13 mil euros" (Portuguese, Spanish), "13 tys." (Polish), "13 Tsd." (German): 13000
    .replace(/\b(\d{1,3})[\s ]?(?:mil|mila|tys|tsd)\b\.?/gi, (thousands, count) => `${count}000`)
    .replace(/\b1\/(4|8|16|32|64)(?!\d)/g, (round, last) => String(2 * Number(last)));

// The rounds of a cup an article writes in words ("осминафиналето", "Achtelfinale", "huitièmes de finale"),
// the figure a text may write them with: a round of 16 is the one of the eighth-finals. Only for a text of
// the AI checked against its article (figuresIn), never to compare a text with its translation: the
// translation may say "eighth-finals" with no figure at all
const ROUNDS = [
    [16, /осмин|osmin|achtelfinal|huiti[eè]mes? de finale|octavos? de final|ottavi di final|oitavos? de final|ósm[ey]j? final/i],
    [32, /шеснаесетин|šesnaestin|sechzehntelfinal|seizi[eè]mes? de finale|dieciseisavos|sedicesimi di final|dezasseis avos/i],
    [8, /четвртфинал|четвъртфинал|četvrtfinal|viertelfinal|quarts? de finale|cuartos? de final|quarti di final|quartos? de final|ćwierćfinał/i],
];
// the figures of a sentence, whatever their separators: "1.1383" and "1,1383", "1,000" and "1 000" are
// the same figure, "September 21, 2026" two of them, and "7 p.m." the same as "19h00"
const figures = (text) => (sameWrittenFigures(text).match(/\d+(?:[.,\u202f\u00a0 ]\d{3}(?!\d))*(?:[.,]\d+)?/g) ?? [])
    .map(figure => figure.replace(/[^\d]/g, ''));
export const figuresOf = figures;
// the figures of a text and the ones its words about the rounds of a cup give
export const figuresIn = (text) => [...figures(text), ...ROUNDS.filter(([, words]) => words.test(text)).map(([round]) => String(round))];
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

const translatePrompt = (sentences, from, to, again = false) => `Translate these sentences of a news article from ${from} into ${to}.
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. Names of
people, organisations and places stay as they are.${again ? `
A previous translation of these sentences lost or changed a figure (a number, a time, a score, a round of a
cup): write every figure of the original as it is, a number written in words stays in words.` : ''}

${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per sentence, in the same order]}`;

export {ORIGINAL_END, ORIGINAL_START, withoutOriginalMarks};
const TRANSLATE_ATTEMPTS = 3;

// The passages translated sentence by sentence: a sentence translated with all its figures is kept, the
// ones that are not are asked again (told so), then left in their language between parentheses (marked:
// in italics, see above) instead of the whole card losing its translation to one of them (30.10.2026:
// "1/8-finals" written "round of 16" cost a card all of it). null when the AI does not answer one
// translation per sentence, or when it could not translate half of them: the reader gets the original only
export const translatePassages = async (passages, from, to, usage = null, {marked = false} = {}) => {
    const sentences = passages.flat().map(sentence => sentence.text);
    const done = new Array(sentences.length).fill(null);
    let lost = sentences.map((sentence, i) => i);
    for (let attempt = 0; attempt < TRANSLATE_ATTEMPTS && lost.length > 0; attempt++) {
        const answer = await ollamaJson(translatePrompt(lost.map(i => sentences[i]), from, to, attempt > 0), usage).catch(() => null);
        const translations = answer?.translations;
        if (!Array.isArray(translations) || translations.length !== lost.length) continue;
        lost = lost.filter((i, k) => {
            const translation = translations[k];
            if (typeof translation !== 'string' || !translation.trim() || !keepsFigures(sentences[i], translation)) return true;
            done[i] = translation.trim();
            return false;
        });
    }
    if (lost.length * 2 > sentences.length) return null;
    let next = 0;
    return passages.map(passage => passage.map(sentence => {
        const i = next++;
        if (done[i] !== null) return {text: done[i], quote: sentence.quote};
        const original = `(${sentence.quote ? `“${sentence.text}”` : sentence.text})`;
        return {text: marked ? `${ORIGINAL_START}${original}${ORIGINAL_END}` : original, quote: false};
    }));
};

const textsPrompt = (texts, to) => `Translate these titles and descriptions of news articles into ${to}. Each one
says its language between parentheses before it.
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. Names of
people, organisations and places stay as they are. A text cut at its end stays cut.

${texts.map(({text, from}, i) => `[${i + 1}] (${from}) ${text}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per text, in the same order]}`;

// Titles and descriptions of several languages translated into 'to' (a language name) in one call:
// texts [{text, from}], 'from' a language name. Answers one translation per text, null for one that
// dropped a figure; all null when the AI does not answer one per text, asked once more first
export const translateTexts = async (texts, to, usage = null) => {
    for (let attempt = 0; attempt < 2; attempt++) {
        const answer = await ollamaJson(textsPrompt(texts, to), usage).catch(() => null);
        const translations = answer?.translations;
        if (!Array.isArray(translations) || translations.length !== texts.length) continue;
        return texts.map(({text}, i) => {
            // the AI often writes the number of the text again, its language sometimes: "[1] (German) ..."
            const translation = typeof translations[i] === 'string' ? translations[i].replace(/^\s*\[\d+\]\s*(?:\([^)]*\)\s*)?/, '').trim() : '';
            return translation && keepsFigures(text, translation) ? translation : null;
        });
    }
    return texts.map(() => null);
};

// The language of passages and their translation for a reader of 'language' (a code), null when they
// are in that language already or could not be translated safely: {from, translation}
export const translationFor = async (passages, language, usage = null, fallback = null, {marked = false} = {}) => {
    const from = ownLanguage(passages.flat().map(sentence => sentence.text).join(' '), fallback);
    const translation = passages.length > 0 && from && from !== language && writtenIn(from) && writtenIn(language)
        ? await translatePassages(passages, writtenIn(from), writtenIn(language), usage, {marked})
        : null;
    return {from, translation};
};

// The key passages of an article for a reader of 'language' (a code: 'fr', 'en'...). page: the page
// read ({content, blocks}). Returns {passages, translation, points, pointsTranslation, digest,
// digestTranslation, from, topic, sourcing}: passages as published, translation null when the article
// is in the language of the reader or could not be translated safely; points and digest the shorter
// ways of the card (see shorterWays), passages too; passages empty when the page has no text of its own
export const extractArticle = async (title, page, {language = 'en', usage = null, marked = false} = {}) => {
    const sentences = sentencesOf(page);
    if (sentences.length === 0) {
        return {passages: [], translation: null, points: [], pointsTranslation: null, digest: [], digestTranslation: null,
            from: null, topic: null, sourcing: null};
    }

    const answer = await ollamaJson(extractPrompt(title, sentences), usage);
    const passages = buildExtract(sentences, answer?.sentences);
    const {points, digest} = shorterWays(sentences, answer?.sentences);
    const {from, translation} = await translationFor(passages, language, usage, languageOf(page.content), {marked});
    // the shorter ways are sentences of the passages: their translation is the one of the passages
    const translated = translation && new Map(passages.flat().map((sentence, i) => [sentence, translation.flat()[i]]));
    const inReader = (ways) => translated ? ways.map(passage => passage.map(sentence => translated.get(sentence))) : null;

    return {
        passages,
        translation,
        points,
        pointsTranslation: inReader(points),
        digest,
        digestTranslation: inReader(digest),
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
