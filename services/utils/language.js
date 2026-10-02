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
    pt: 'os um uma dos das em ao não com mais seu sua pelo pela foi são',
    cs: 'že jsou pro jak už jako ale od byl bylo jeho které který také nebo při',
    pl: 'się nie że jest jak po od już dla oraz przez był jego które który także tym',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([language, words]) => [language, new Set(words.split(' '))]));
const MIN_HITS = 2;             // under this the text says nothing, the default is kept
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
// Serbian. The country of the site decides between them
const NEAR_LANGUAGES = new Set(['hr', 'bs', 'sr']);
const COUNTRY_LANGUAGE = {hr: 'hr', ba: 'bs', rs: 'sr', me: 'sr'};

// the language its short words tell, null under MIN_HITS
const wordsLanguage = (text) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    let best = null;
    let bestHits = MIN_HITS - 1;

    for (const [language, set] of Object.entries(SETS)) {
        const hits = words.reduce((count, word) => count + (set.has(word) ? 1 : 0), 0);
        if (hits > bestHits) {
            best = language;
            bestHits = hits;
        }
    }
    return best;
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
    const words = wordsLanguage(text);
    if (fallback) return words ?? fallback;
    return longTextLanguage(text ?? '', words);
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
