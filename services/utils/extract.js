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
import {ORIGINAL_END, ORIGINAL_START, UNCHECKED, withoutOriginalMarks} from './original-marks.js';
import {alignNames, spellingNote, spellingsOf} from './spellings.js';

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

// A date and a dash before the first words of a sentence, the dateline of a news agency ("November 6 – FIFA wants the IOC to…",
// "Zurich, 27 October 2026 — The IFAB…", "06.11.2026 - …"): it dates the news, it is no part of what the article says, and showed
// in the key points as their first words (the user's friend, 6.11.2026). The month is one of MONTHS, a place may come before the
// date, a day of the week may come before it ("Wednesday 6 November –"), a year ("2026", "de 2026") and a time ("14:30", "14h30") after
// it, and a figure after the dash ("November 6 – 8 November", a range) leaves it
const WEEKDAY = /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\.?,?\s+/iu;
const DATELINE = new RegExp(String.raw`^(?:\p{Lu}[\p{L}.'’ -]{1,30},\s+)?(?:(?:\d{1,2}(?:st|nd|rd|th|er|º|\.)?\s+(?:of\s+|de\s+|del\s+|di\s+)?(\p{L}+)|(\p{L}+)\s+\d{1,2}(?:st|nd|rd|th)?)(?:,?\s+(?:de\s+)?\d{4})?(?:,?\s+(?:at\s+|à\s+|um\s+|alle\s+|a\s+las\s+)?\d{1,2}[:h.]\d{2})?|(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[0-2])(?:[./]\d{2,4})?\.?)\s*[–—−-]+\s+(?!\d)`, 'u');
export const withoutDateline = (sentence) => {
    const text = String(sentence ?? '');
    const weekday = text.match(WEEKDAY)?.[0] ?? '';
    const found = text.slice(weekday.length).match(DATELINE);
    if (!found) return sentence;
    const month = found[1] ?? found[2];
    return month === undefined || MONTH_OF.has(month.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()) ? text.slice(weekday.length + found[0].length) : sentence;
};
// The first sentence of an article without its dateline, as it was when what is left is no sentence any more. Only the first: a date
// and a dash further on open the line of a timeline ("March 5 – police arrested…"), which the date is part of
const undated = (text) => {
    const bare = withoutDateline(text);
    return bare !== text && isSentence(bare) ? bare : text;
};

const segmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
// "M.", "Mr.", "Dr.", "U.S.", "St.", "Guild v.": a sentence does not end there
const ABBREVIATION = /(?:^|[\s(])(?:[A-Za-z]|[A-Z][a-z]{1,2}|Mme|Mlle|Mgr|n°|No|vs|etc|(?:[A-Z]\.)+[A-Z])\.\s*$/;
// a number of one or two figures and its point, at the end of a piece: an ordinal ("5.", "21.", "90.") when a capital follows
const ORDINAL = /(?:^|[\s(])\d{1,2}\.$/;

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
        // an ordinal number written with its point ("am 5. November", "nach dem 21. Spieltag", "in der 90. Minute": German, Czech, Finnish) ends no
        // sentence either: it was cut there, the first part lost its date or ended on "21." (the corpus of tests/regression)
        if (previous !== undefined && (/^[»”’)\]]|^"(?!\p{L})|^\p{Ll}|^\d+\)/u.test(sentence) || ABBREVIATION.test(previous)
            || (ORDINAL.test(previous) && /^\p{Lu}/u.test(sentence)))) {
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
export const splitSentences = (text) => {
    const sentences = cut((text ?? '').slice(0, MAX_CONTENT_CHARS)).filter(isSentence).slice(0, MAX_SENTENCES);
    return sentences.length > 0 ? [undated(sentences[0]), ...sentences.slice(1)] : sentences;
};

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
            if (isSentence(text)) sentences.push({text: sentences.length === 0 ? undated(text) : text, quote: block.kind === 'quote'});
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
// The units of number Korean, Chinese and Japanese write after a figure: "2만" is 20,000, "1억" 100 million, "12만 5천" 125,000 (the
// briefing of Enzo of 8.11.2026: a Korean sentence with "2만" was refused for a figure lost and left in Korean between parentheses).
// 조 after a digit is also the count of an article of a law ("제3조"), so it is a unit only without the 제
const CJK_UNITS = {천: 1e3, 千: 1e3, 백: 1e2, 百: 1e2, 만: 1e4, 万: 1e4, 萬: 1e4, 억: 1e8, 億: 1e8, 조: 1e12, 兆: 1e12};
const CJK_PART = '(?<!제)\\d[\\d,]*(?:\\.\\d+)?\\s*[천千백百만万萬억億조兆]+';
const CJK_AMOUNT = new RegExp(`${CJK_PART}(?:\\s*${CJK_PART})*`, 'gu');
const CJK_PIECE = /(\d[\d,]*(?:\.\d+)?)\s*([천千백百만万萬억億조兆]+)/gu;
const withCjkAmounts = (text) => text.replace(CJK_AMOUNT, amount => String(Math.round([...amount.matchAll(CJK_PIECE)]
    .reduce((sum, [, count, units]) => sum + Number(count.replace(/,/g, '')) * [...units].reduce((product, unit) => product * CJK_UNITS[unit], 1), 0))));
// The words the other languages write a thousand, a million or a billion with after a figure ("2 million", "2 Millionen", "2 millones")
const WORD_UNITS = [[1e3, 'thousand'], [1e6, 'millions?|millón|millones|milhão|milhões|millionen|miljoen|milioni|milione|mio|mln|miljoona'],
    [1e9, 'billions?|milliards?|milliarden?|miliardi|miliardo|mrd']];
const NUMBER = '\\d+(?:[.,\\u202f\\u00a0 ]\\d{3}(?!\\d))*(?:[.,]\\d+)?';
const FIGURE = new RegExp(`(${NUMBER})(?:[\\s\\u00a0]*(${WORD_UNITS.map(([, words]) => words).join('|')})(?!\\p{L}))?`, 'giu');
const unitOf = (word) => WORD_UNITS.find(([, words]) => new RegExp(`^(?:${words})$`, 'iu').test(word))[0];
// The figures of a sentence, whatever their separators: "1.1383" and "1,1383", "1,000" and "1 000" are the same figure, "September 21,
// 2026" two of them, and "7 p.m." the same as "19h00". Each is the ways it may be written in digits: "2 million" is "2" or "2000000"
// (the way it was written, or in full: the translation of "2 000 000" says "2 million" and the reverse), "2만" "20000" only
export const figureEntries = (text) => [...withCjkAmounts(sameWrittenFigures(text)).matchAll(FIGURE)].map(([, number, unit]) => {
    const raw = number.replace(/[^\d]/g, '');
    if (!unit) return [raw];
    const count = /^\d+[.,]\d{1,2}$/.test(number) ? Number(number.replace(',', '.')) : Number(raw);
    return [raw, String(Math.round(count * unitOf(unit)))];
});
// the figures of a text and the ones its words about the rounds of a cup give, every way they may be written
export const figuresIn = (text) => [...figureEntries(text).flat(), ...ROUNDS.filter(([, words]) => words.test(text)).map(([round]) => String(round))];
// The months of the languages a translation is written in, by their number (accents off): a date written "5/11" or "tháng 11"
// is "November 5" in a translation, whose month is a word and no figure (a card of 6.11.2026 with three such dates lost all its
// translation: more than half of its sentences were refused, the Vietnamese was shown as it was)
const MONTHS = [
    ['january', 'janvier', 'enero', 'gennaio', 'januar', 'janeiro', 'januari', 'jan'],
    ['february', 'fevrier', 'febrero', 'febbraio', 'februar', 'fevereiro', 'februari', 'feb'],
    ['march', 'mars', 'marzo', 'marz', 'maart', 'marco'],
    ['april', 'avril', 'abril', 'aprile', 'apr'],
    ['may', 'mai', 'mayo', 'maggio', 'maio', 'mei'],
    ['june', 'juin', 'junio', 'giugno', 'juni', 'junho', 'jun'],
    ['july', 'juillet', 'julio', 'luglio', 'juli', 'julho', 'jul'],
    ['august', 'aout', 'agosto', 'augustus', 'aug'],
    ['september', 'septembre', 'septiembre', 'setiembre', 'settembre', 'setembro', 'sept', 'sep'],
    ['october', 'octobre', 'octubre', 'ottobre', 'oktober', 'outubro', 'oct', 'okt'],
    ['november', 'novembre', 'noviembre', 'novembro', 'nov'],
    ['december', 'decembre', 'diciembre', 'dicembre', 'dezember', 'dezembro', 'dec', 'dez'],
];
const MONTH_OF = new Map(MONTHS.flatMap((names, i) => names.map(name => [name, i + 1])));
// the numbers of the months a text names ("may" is one only beside a figure: "it may rain" is none)
const monthsNamed = (text) => {
    const plain = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const mayIsMonth = /\bmay\s+\d|\d(?:st|nd|rd|th)?\s+(?:of\s+)?may\b/.test(plain);
    return (plain.match(/\p{L}+/gu) ?? []).filter(word => word !== 'may' || mayIsMonth).map(word => MONTH_OF.get(word)).filter(Boolean);
};

// a translation keeps every figure of the sentence it translates, checked here rather than trusted. A figure from 1 to 12 may
// have become the month of its date (see MONTHS)
export const keepsFigures = (original, translation) => {
    const left = figureEntries(translation);
    const months = monthsNamed(translation);
    return figureEntries(original).every(ways => {
        const i = left.findIndex(entry => entry.some(figure => ways.includes(figure)));
        if (i >= 0) {
            left.splice(i, 1);
            return true;
        }
        const month = months.indexOf(Number(ways[0]));
        if (month < 0) return false;
        months.splice(month, 1);
        return true;
    });
};

// A name written in another alphabet can't "stay as it is": the AI guessed its Latin spelling, better with a
// first name and a sentence than for a word alone ("Frapar" for "Φραπάρ" in a title, "Stéphanie Frappart" in
// the text of the card, briefings 252 and 253 of 27.10.2026), and gave a man a woman's first name
// ("Stéphanie Lannoy" for "Στεφάν Λανουά"). The spellings of the card are told to the translation too
// (see spellings.js)
const NAMES_RULE = `Names of people, organisations and places stay as they are; a name written in another alphabet than
the Latin one (Greek, Cyrillic, Arabic, Chinese...) is written as the international press and Wikipedia spell it in the
Latin alphabet ("Μπαπέ" is "Mbappé"), and when you do not know that spelling, transliterated sound by sound, the same
way each time. A man's first name never becomes a woman's, nor the reverse (Stéphane and Stéphanie are two people): the
articles and the endings of the original often say which.
An acronym of the original (ADN, DNA, FSS, CAF) is the name of a body or of a thing: it is kept as written, never read as the
common word it looks like (the "ADN" of a refereeing directorate is not "deoxyribonucleic acid"), unless you know for sure it
has an established form in the target language (UEFA stays UEFA, "ONU" becomes "UN").`;

const translatePrompt = (sentences, from, to, again = false, note = '') => `Translate these sentences of a news article from ${from} into ${to}.
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. ${NAMES_RULE}${again ? `
A previous translation of these sentences lost or changed a figure (a number, a time, a score, a round of a
cup): write every figure of the original as it is, a number written in words stays in words.` : ''}${note ? `
${note}` : ''}

${sentences.map((sentence, i) => `[${i + 1}] ${sentence}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per sentence, in the same order]}`;

export {ORIGINAL_END, ORIGINAL_START, UNCHECKED, withoutOriginalMarks};
const TRANSLATE_ATTEMPTS = 3;

// The passages translated sentence by sentence: a sentence translated with all its figures is kept, the
// ones that are not are asked again (told so), then left in their language between parentheses (marked:
// in italics, see above) instead of the whole card losing its translation to one of them (30.10.2026:
// "1/8-finals" written "round of 16" cost a card all of it). null when the AI does not answer one
// translation per sentence, or when it could not translate half of them: the reader gets the original only.
// glossary: [{written, spelled}], the names of the news as Wikidata spells them, names the ones its other
// news spell (see spellings.js)
export const translatePassages = async (passages, from, to, usage = null, {marked = false, glossary = [], names = []} = {}) => {
    const sentences = passages.flat().map(sentence => sentence.text);
    const done = new Array(sentences.length).fill(null);
    const note = spellingNote({glossary, names});
    const spelled = spellingsOf({glossary, names});
    // the last translation of a sentence whose figures could not be matched to the original's, to show with a warning (see below)
    const unchecked = new Array(sentences.length).fill(null);
    let lost = sentences.map((sentence, i) => i);
    for (let attempt = 0; attempt < TRANSLATE_ATTEMPTS && lost.length > 0; attempt++) {
        const answer = await ollamaJson(translatePrompt(lost.map(i => sentences[i]), from, to, attempt > 0, note), usage).catch(() => null);
        const translations = answer?.translations;
        if (!Array.isArray(translations) || translations.length !== lost.length) continue;
        lost = lost.filter((i, k) => {
            const translation = translations[k];
            if (typeof translation !== 'string' || !translation.trim()) return true;
            const written = alignNames(translation.trim(), spelled, sentences[i]);
            if (!keepsFigures(sentences[i], translation)) {
                unchecked[i] = written;
                return true;
            }
            done[i] = written;
            unchecked[i] = null;
            return false;
        });
    }
    // In a briefing a sentence the AI translated but whose figures the check could not match is shown translated, in italics, with a
    // warning, rather than left in its own language (the user, 8.11.2026: it should be translated; the Korean "2만" of a card was
    // refused for a figure lost and stayed Korean, and the guard is right to doubt a translation but not to take it from the reader).
    // Where nothing can warn (the search) it is left in its language between parentheses as before. Only a sentence with no
    // translation at all is lost
    const shown = marked ? lost.filter(i => unchecked[i] === null) : lost;
    if (shown.length * 2 > sentences.length) return null;
    let next = 0;
    return passages.map(passage => passage.map(sentence => {
        const i = next++;
        if (done[i] !== null) return {text: done[i], quote: sentence.quote};
        if (marked && unchecked[i] !== null) {
            return {text: `${ORIGINAL_START}${sentence.quote ? `“${unchecked[i]}”` : unchecked[i]} ${UNCHECKED}${ORIGINAL_END}`, quote: false};
        }
        const original = `(${sentence.quote ? `“${sentence.text}”` : sentence.text})`;
        return {text: marked ? `${ORIGINAL_START}${original}${ORIGINAL_END}` : original, quote: false};
    }));
};

// what a text is told of the spelling of its names, on the line under it
const hintOf = (item) => {
    const note = spellingNote(item);
    return note ? `\n    ${note}` : '';
};

const textsPrompt = (texts, to, again = false) => `Translate these titles and descriptions of news articles into ${to}. Each one
says its language between parentheses before it.${texts.some(item => item.guess) ? `
The language of a text marked with a question mark is only a guess: say in "languages" the language it is really written in, in English
("Slovenian"), and null for the others.` : ''}
Translate each one faithfully and completely: the same facts, the same figures, the same names, the
same certainty (may, reportedly, alleged, planned), nothing added and nothing left out. ${NAMES_RULE} A text cut at
its end stays cut.${again ? `
A previous translation of these texts was empty or lost or changed a figure (a number, a time, a score, a round of a
cup, the 1 of "Liga 1"): write every figure of the original as it is.` : ''}

${texts.map((item, i) => `[${i + 1}] (${item.from}${item.guess ? '?' : ''}) ${item.text}${hintOf(item)}`).join('\n')}

Answer only in JSON: {"translations": ["...", one per text, in the same order]${texts.some(item => item.guess) ? ', "languages": [one per text, the language of a text marked with ?, else null]' : ''}}`;

// Titles and descriptions of several languages translated into 'to' (a language name) in one call:
// texts [{text, from, glossary, names}], 'from' a language name; glossary [{written, spelled}] the names of
// the news as Wikidata spells them, names the ones the card already spells (the translation of its text):
// told to the AI, and a word of the translation a consonant off one of them put back as they spell it (see
// spellings.js). Answers one translation per text, null for one that dropped a figure; all null when the AI
// does not answer one per text. Asked again, told so, for what does not come back whole: a call that answers another
// number of translations, and the texts that came back empty or without a figure (a Peruvian title of 6.11.2026 stayed
// Spanish for one such answer, the same card was translated in another briefing). A text with 'guess' true has a language the code
// only guessed (see titleLanguage): the AI that translates it says the language it is really written in, and 'languages', an array
// given, is filled with it (an English name, "Slovenian") at the place of the text: a Slovenian title of names that franc read
// Bosnian, for nothing more than a few tokens
const TEXTS_ATTEMPTS = 3;
export const translateTexts = async (texts, to, usage = null, {languages = null} = {}) => {
    const done = new Array(texts.length).fill(null);
    let open = texts.map((item, i) => i);
    for (let attempt = 0; attempt < TEXTS_ATTEMPTS && open.length > 0; attempt++) {
        const answer = await ollamaJson(textsPrompt(open.map(i => texts[i]), to, attempt > 0), usage).catch(() => null);
        const translations = answer?.translations;
        if (!Array.isArray(translations) || translations.length !== open.length) continue;
        open.forEach((i, k) => {
            const said = Array.isArray(answer.languages) ? answer.languages[k] : null;
            if (languages && texts[i].guess && typeof said === 'string' && said.trim()) languages[i] = said.trim();
        });
        open = open.filter((i, k) => {
            // the AI often writes the number of the text again, its language sometimes: "[1] (German) ..."
            const translation = typeof translations[k] === 'string' ? translations[k].replace(/^\s*\[\d+\]\s*(?:\([^)]*\)\s*)?/, '').trim() : '';
            if (!translation || !keepsFigures(texts[i].text, translation)) return true;
            done[i] = alignNames(translation, spellingsOf(texts[i]), texts[i].text);
            return false;
        });
    }
    return done;
};

// The language of passages and their translation for a reader of 'language' (a code), null when they
// are in that language already or could not be translated safely: {from, translation}
export const translationFor = async (passages, language, usage = null, fallback = null, {marked = false, glossary = [], names = []} = {}) => {
    const from = ownLanguage(passages.flat().map(sentence => sentence.text).join(' '), fallback);
    const translation = passages.length > 0 && from && from !== language && writtenIn(from) && writtenIn(language)
        ? await translatePassages(passages, writtenIn(from), writtenIn(language), usage, {marked, glossary, names})
        : null;
    return {from, translation};
};

// The key passages of an article for a reader of 'language' (a code: 'fr', 'en'...). page: the page
// read ({content, blocks}). Returns {passages, translation, points, pointsTranslation, digest,
// digestTranslation, from, topic, sourcing}: passages as published, translation null when the article
// is in the language of the reader or could not be translated safely; points and digest the shorter
// ways of the card (see shorterWays), passages too; passages empty when the page has no text of its own
export const extractArticle = async (title, page, {language = 'en', usage = null, marked = false, glossary = [], names = []} = {}) => {
    const sentences = sentencesOf(page);
    if (sentences.length === 0) {
        return {passages: [], translation: null, points: [], pointsTranslation: null, digest: [], digestTranslation: null,
            from: null, topic: null, sourcing: null};
    }

    const answer = await ollamaJson(extractPrompt(title, sentences), usage);
    const passages = buildExtract(sentences, answer?.sentences);
    const {points, digest} = shorterWays(sentences, answer?.sentences);
    const {from, translation} = await translationFor(passages, language, usage, languageOf(page.content), {marked, glossary, names});
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
