//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: language.js
//  Description: The language of a news, read from its most common words
//

"use strict"

import {franc} from 'franc';

// The stories are grouped per language: two titles in two languages about the same event are too
// often the same actor doing two different things (measured on the judged pairs). The feeds of the
// project have a language, but the ones a user adds or a profile discovers do not always say theirs,
// so the language is read from the text: the short words of a language are the most frequent ones.
const WORDS = {
    fr: 'le la les des une un du et est dans pour sur au aux avec par pas qui que ce cette son ses sont plus leur',
    en: 'the a an of and is in for on to with by not who that this his her are more from at as its was',
    es: 'el la los las un una del y es en para con por que se su sus al como más pero',
    it: 'il lo la gli le un una del della di e è in per con che si non al come più sono',
    de: 'der die das den dem des ein eine und ist im in für mit von auf nicht sich zu dass wird bei',
    // No reader reads them: they are here so that a feed in them is not taken for one of the others.
    // Last, so a tie goes to the languages above ("Van Dijk", "para")
    nl: 'het een van op met voor niet zijn dat aan bij ook naar om wordt werd hun deze nog maar uit',
    // not "da" (Italian too), "no" (Spanish), "o", "do", "na" (Polish and Czech: a pzpn.pl feed was told Portuguese)
    pt: 'os um uma dos das em ao não com mais seu sua pelo pela foi são à às é nas já após também está muito ela num numa',
    cs: 'že jsou pro jak už jako ale od byl bylo jeho které který také nebo při',
    pl: 'się nie że jest jak po od już dla oraz przez był jego które który także tym',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([language, words]) => [language, new Set(words.split(' '))]));
const MIN_HITS = 2;             // under this the text says nothing, the default is kept
// The language of the feed is kept unless another one has FEED_MARGIN more short words. Measured on
// up to 4000 news each of national media (bench/language-pt.mjs, their domain gives the language):
// the Portuguese ones were 73.5% right, as "que", "para", "e", "a" are Spanish, Italian, English words
// too (a sapo.pt card on Ceferin left untranslated and alone in its story, 14.10.2026); with the
// Portuguese words above and this margin 92.5%, Czech 59.9 -> 87.4%, Polish 96.7 -> 99.6%, Italian
// 98.0 -> 98.6%, French 99.0 -> 99.8%, Spanish, German, English, Slovak the same. A margin of 2 kept
// Czech at 75.5%
const FEED_MARGIN = 3;
const FEED_TEXTS = 30;          // the news of a feed read to tell its language
const FEED_TOLD = 1 / 3;        // the share of them that must tell one
const FEED_AGREE = 0.6;         // the share of those that must tell the same

// The other languages are told by franc, from the groups of three letters of a text: right on a long
// text, unsure on a title (a Russian title came out Ukrainian, a Spanish feed would come out Catalan
// on a few lines). Its codes (ISO 639-3) as the project writes them (ISO 639-1); the others, and the
// languages of a few hundred thousand readers it does not know (Icelandic, Faroese), stay untold
const FRANC_CODES = {
    eng: 'en', fra: 'fr', spa: 'es', ita: 'it', deu: 'de', nld: 'nl', por: 'pt', ces: 'cs', pol: 'pl',
    hun: 'hu', ell: 'el', hrv: 'hr', srp: 'sr', bos: 'bs', swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi',
    ron: 'ro', bul: 'bg', rus: 'ru', ukr: 'uk', bel: 'be', tur: 'tr', slk: 'sk', slv: 'sl', ekk: 'et', lvs: 'lv',
    lit: 'lt', kat: 'ka', hye: 'hy', azj: 'az', kaz: 'kk', mkd: 'mk', als: 'sq', heb: 'he', cat: 'ca', glg: 'gl',
    arb: 'ar', pes: 'fa', urd: 'ur', hin: 'hi', ben: 'bn', cmn: 'zh', jpn: 'ja', kor: 'ko', ind: 'id', zlm: 'ms',
    vie: 'vi', tha: 'th', swh: 'sw', afr: 'af', tgl: 'tl', uzn: 'uz',
};
const MIN_TRIGRAM_CHARS = 200;  // shorter, the short words are surer
// Croatian, Bosnian and Serbian are written alike: franc gave index.hr Bosnian and oslobodjenje.ba
// Serbian. The country of the site decides between them. Galician and Portuguese too: the feed of
// uol.com.br was told Galician (693 news in 3 days, 14.10.2026)
const NEAR_LANGUAGES = new Set(['hr', 'bs', 'sr', 'gl']);
const COUNTRY_LANGUAGE = {hr: 'hr', ba: 'bs', rs: 'sr', me: 'sr', br: 'pt', pt: 'pt'};

// A word of the text that only one of the languages writes, whatever its short words: a word in small
// letters with a ã, or ending in -ões, is Portuguese ("farão", "avião", "televisões"). Not a name with
// one (João, Simão: they are written in any language, capital first), nor a text with the letters of
// Vietnamese, which has ã too ("đã"); õ alone is Estonian ("või", "õpetaja"). A Portuguese title reached
// through a search in Italian, Spanish or English was told that language 6 times in 10 (a poder360.com.br
// card of Brazil's press on LaLiga's referees was told Italian, 3.11.2026): with the rule 7 in 10, and the
// Portuguese news of Portuguese feeds 97.5 -> 99.2%; 1 of 15000 news of national media in Spanish, Italian,
// French, English or German became Portuguese (bench/language-pt-mark.mjs).
// It decides: a text with one is Portuguese, whatever the language of its feed and the short words of the others
const DECISIVE = 100;
const MARKED = {pt: /^\p{Ll}*(ã|ões$)/u};
const VIETNAMESE = /[đĐơƠưƯẠ-ỹ]/u;
const markedWords = (language, text) => !MARKED[language] || VIETNAMESE.test(text ?? '') ? 0
    : ((text ?? '').match(/[\p{L}]+/gu) ?? []).some(word => MARKED[language].test(word)) ? DECISIVE : 0;

// the language its short words tell, null under MIN_HITS. 'preferred' (the language of the feed) is
// kept unless another one has FEED_MARGIN more: a Spanish title of a Spanish search with three "la"
// and no other short word counts as much French as Spanish, and was told French
const wordsLanguage = (text, preferred = null) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    let best = null;
    let bestHits = MIN_HITS - 1;
    let preferredHits = 0;

    for (const [language, set] of Object.entries(SETS)) {
        const hits = words.reduce((count, word) => count + (set.has(word) ? 1 : 0), 0) + markedWords(language, text);
        if (language === preferred) preferredHits = hits;
        if (hits > bestHits) {
            best = language;
            bestHits = hits;
        }
    }
    return best && preferred && SETS[preferred] && bestHits - preferredHits < FEED_MARGIN ? preferred : best;
};

// the language of a long text by its groups of letters: franc when it says one outside the 9 the
// short words know, or when they tell none. Measured on 1056 feeds (bench/language-rules.mjs, their
// 30 news joined): the 385 shared feeds all right (the words alone took Spiegel International for
// German), and 63 of 68 feeds in other languages, where the words alone told none. Feeds of the
// directory the words had taken for English were in Arabic, Turkish, Albanian, Vietnamese, Ukrainian
const longTextLanguage = (text, words) => {
    const trigrams = FRANC_CODES[franc(text, {minLength: MIN_TRIGRAM_CHARS})] ?? null;
    return trigrams && (!words || !SETS[trigrams]) ? trigrams : words;
};

// The language of a news or of a text: 'fr', 'en', 'hu'..., the default when the text can't tell.
// The default is the language of its feed: one the short words do not know is kept whatever its news
// look like (a Hungarian title with "a" and "is" passed for English): measured on the news of 68 feeds
// in such languages, 94.5% right, 76.2% when the words could still decide. A text without a default
// is read by its words, and by its groups of letters when it is long
export const languageOf = (text, fallback = null) => {
    if (fallback && !SETS[fallback]) return fallback;
    const words = wordsLanguage(text, fallback);
    if (fallback) return words ?? fallback;
    return longTextLanguage(text ?? '', words);
};

// The language of a text read for itself before its default: the default is a guess on something
// else (the whole page of an article: menus and side links in English took the Vietnamese passages
// of a vietnam.vn card for English, shown untranslated to an English reader, 17.10.2026). A text of
// MIN_TRIGRAM_CHARS and more keeps its own language when franc names it and the short words do not
// say another; shorter, or in a language written like another (NEAR_LANGUAGES), the default decides
// as in languageOf
export const ownLanguage = (text, fallback = null) => {
    const trigrams = FRANC_CODES[franc(text ?? '', {minLength: MIN_TRIGRAM_CHARS})] ?? null;
    if (trigrams && !NEAR_LANGUAGES.has(trigrams) && languageOf(text) === trigrams) return trigrams;
    return languageOf(text, fallback);
};

// The language a SHORT text is written in when its letters are not Latin: Arabic, Cyrillic, Greek, Hebrew, Chinese, Japanese,
// Korean, Thai, Devanagari, Bengali, Georgian, Armenian. A title is far under MIN_TRIGRAM_CHARS, the short words know 9 languages
// of Latin letters, so a title in another script kept the language of its feed: the Persian edition of Afghanistan International
// (afintl.com) is read in an English feed and was labelled English, and 12 616 of the 19 286 news written in Arabic letters of
// 5.11.2026 had another label. A letter outside the script of a language tells that language, whatever the feed: the script
// picks the languages franc may name (a title of 10 letters at least), else the commonest of them. null for a title in Latin
// letters (the label stands), or with too few letters
const SCRIPTS = [
    [/[぀-ヿ]/gu, ['jpn']],
    [/[一-鿿]/gu, ['cmn', 'jpn']],
    [/[가-힯]/gu, ['kor']],
    [/[؀-ۿݐ-ݿ]/gu, ['arb', 'pes', 'urd']],
    [/[Ѐ-ӿ]/gu, ['rus', 'ukr', 'bul', 'srp', 'mkd', 'bel', 'kaz']],
    [/[Ͱ-Ͽἀ-῿]/gu, ['ell']],
    [/[֐-׿]/gu, ['heb']],
    [/[฀-๿]/gu, ['tha']],
    [/[ऀ-ॿ]/gu, ['hin']],
    [/[ঀ-৿]/gu, ['ben']],
    [/[Ⴀ-ჿ]/gu, ['kat']],
    [/[԰-֏]/gu, ['hye']],
];
export const scriptLanguage = (text, label = null) => {
    const letters = (String(text ?? '').match(/\p{L}/gu) ?? []).length;
    if (letters < 4) return null;
    for (const [pattern, codes] of SCRIPTS) {
        const hits = (text.match(pattern) ?? []).length;
        // kana make Japanese with any number of Chinese characters; the others need most of the letters
        if (hits === 0 || (codes[0] !== 'jpn' || codes.length > 1 ? hits / letters < 0.6 : hits / letters < 0.1)) continue;
        // a label that is one of the languages of the script stands: franc takes a short Russian title for Bulgarian
        if (label && codes.some(code => FRANC_CODES[code] === label)) return label;
        const named = codes.length === 1 ? codes[0] : franc(text, {minLength: 10, only: codes});
        return FRANC_CODES[named] ?? FRANC_CODES[codes[0]];
    }
    return null;
};

// A title in Latin letters whose accents are not English's: "Můj cíl je jasný: sloužit fotbalu a lidem" came from a Czech paper read
// in a feed declared English (the angle of a card of 4.11.2026 was shown untranslated). Two letters with a mark at least, 3% of
// the letters: franc then says which of the languages of such letters it is, short as it is (the choice is among languages that
// have them, English left out). It is a guess: a football title of names ("Mbappé and Müller shine as Ødegaard returns") passes
// for Danish, so what asks for a translation (see translatedTitles) keeps the title when the translation is the same text.
// null when the marks are few or franc says the label
const ACCENTED = ['ces', 'slk', 'pol', 'hun', 'ron', 'tur', 'vie', 'hrv', 'bos', 'slv', 'swe', 'dan', 'nob', 'fin', 'ekk', 'lvs', 'lit', 'als', 'fra', 'deu', 'spa', 'por', 'ita', 'nld', 'cat', 'glg'];
export const markedLanguage = (text, label = null) => {
    const letters = (String(text ?? '').match(/\p{L}/gu) ?? []).length;
    const marks = (String(text ?? '').match(/[À-ɏḀ-ỿ]/gu) ?? []).length;
    if (letters < 12 || marks < 2 || marks / letters < 0.03) return null;
    let code = FRANC_CODES[franc(text, {minLength: 10, only: ACCENTED})];
    // franc takes Czech for Slovak and back on a short text: ě, ř and ů are Czech's alone, ä, ĺ, ľ, ŕ and ô Slovak's
    if (code === 'sk' && /[ěřů]/iu.test(text)) code = 'cs';
    else if (code === 'cs' && /[äĺľŕô]/iu.test(text)) code = 'sk';
    return code && code !== label ? code : null;
};

// The language a title is really written in, from its letters, the label the database gave it when they say nothing. 'guessed': the
// language came from the accents only (see markedLanguage)
export const titleLanguage = (title, label = null) => {
    const script = scriptLanguage(title);
    if (script) return {language: script, guessed: false};
    // the short words of the 9 languages that have them, read without the label (as the timeline of the analysis reads its titles)
    const words = languageOf(title);
    if (words && words !== label) return {language: words, guessed: false};
    const marked = markedLanguage(title, label);
    return marked ? {language: marked, guessed: true} : {language: label, guessed: false};
};

// The language most of these texts (the news of one feed) are written in, null when too few of them
// tell it or they do not agree. Measured on 345 feeds: every feed of a listed language was told right
// by the words. With franc on the texts joined, the other languages too (see longTextLanguage).
// 'url': the address of the feed, its country decides between languages written alike
export const feedLanguage = (texts, url = null) => {
    const counts = new Map();
    let told = 0;
    for (const text of texts.slice(0, FEED_TEXTS)) {
        const language = wordsLanguage(text);
        if (!language) continue;
        told++;
        counts.set(language, (counts.get(language) ?? 0) + 1);
    }
    const [best, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const judged = Math.min(texts.length, FEED_TEXTS);
    const words = told >= judged * FEED_TOLD && count >= told * FEED_AGREE ? best : null;

    const language = longTextLanguage(texts.slice(0, FEED_TEXTS).join(' '), words);
    if (!NEAR_LANGUAGES.has(language) || !url) return language;
    let country;
    try {
        country = new URL(url).hostname.split('.').pop();
    } catch {
        return language;
    }
    return COUNTRY_LANGUAGE[country] ?? language;
};

// A feed in several languages has none to give its news: the news sitemap of Reuters gives its English,
// Spanish, Portuguese, French, German and Italian news in one feed, was told Spanish when a reader added
// it (the Spanish titles have more short words), and its English titles, often with one short word or
// none, were kept Spanish: 41% of its news of 14 days in the language of their address (/latam/, /pt/,
// /fr/, /de/, /it/, English otherwise), 84% read without the language of the feed
// (bench/language-mixed-feeds.mjs, 17.10.2026). A feed is in several languages when, of its news
// clearly in one (see clearLanguage), MIXED_OTHERS and MIXED_SHARE are in another than most of them.
// Measured on the last 100 news of 7 days of 3158 feeds (bench/language-mixed-detect.mjs): 8 to 10 feeds,
// Reuters (27%), American stations with news in Spanish, Moroccan and African ones in French and
// English. The short words alone took 39, Portuguese and Czech ones among them, whose news read
// without the language of their feed fell from 96 to 52% and from 88 to 46% right; at 10% Somali and
// Basque feeds came in (franc made to choose among the languages below)
const MIXED_OTHERS = 3;
const MIXED_SHARE = 0.2;
export const MIXED_TEXTS = 100;     // the last news of a feed read to tell it
const FRANC_WORDS = Object.keys(FRANC_CODES).filter(code => SETS[FRANC_CODES[code]]);

// the language a text is clearly in, null when unsure: its short words give it MIN_HITS and more than
// any other, and franc, among the languages of the short words, says the same
const clearLanguage = (text) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    const hits = Object.entries(SETS)
        .map(([language, set]) => [language, words.reduce((count, word) => count + (set.has(word) ? 1 : 0), 0)])
        .sort((a, b) => b[1] - a[1]);
    if (hits[0][1] < MIN_HITS || hits[0][1] === hits[1][1]) return null;
    return FRANC_CODES[franc(text, {minLength: 10, only: FRANC_WORDS})] === hits[0][0] ? hits[0][0] : null;
};

// whether these texts (the last news of one feed) are in several languages, see MIXED_OTHERS
export const severalLanguages = (texts) => {
    const counts = new Map();
    for (const text of texts.slice(0, MIXED_TEXTS)) {
        const language = clearLanguage(text);
        if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
    }
    const told = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const others = told - Math.max(0, ...counts.values());
    return others >= MIXED_OTHERS && others >= told * MIXED_SHARE;
};

// The name of a language, in another one: languageName('hu') is "Hungarian", languageName('el', 'fr')
// "grec". The code itself when it names none
const names = new Map();
export const languageName = (code, locale = 'en') => {
    if (!names.has(locale)) names.set(locale, new Intl.DisplayNames([locale], {type: 'language', fallback: 'code'}));
    try {
        return names.get(locale).of(code);
    } catch {
        return code;
    }
};

// The one language a reader reads in: the briefing and the search read the news of every language and
// translate them into it. A profile saved before it had several languages ticked: the one its text is
// written in among them, else the first
export const readerLanguage = ({text = '', languages = []} = {}) => {
    if (languages.length <= 1) return languages[0] ?? 'en';
    const written = languageOf(text);
    return languages.includes(written) ? written : languages[0];
};

// the name in English of a language a text can be told in, for the prompts of the AI; null otherwise
export const writtenIn = (code) => KNOWN_LANGUAGES.includes(code) ? languageName(code) : null;

// the languages told by their short words (the directory only keeps feeds in them)
export const LANGUAGES = Object.keys(WORDS);
// every language a feed or a news can be told in
export const KNOWN_LANGUAGES = [...new Set([...LANGUAGES, ...Object.values(FRANC_CODES)])];
