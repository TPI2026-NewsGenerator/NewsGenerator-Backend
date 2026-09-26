//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: language.js
//  Description: The language of a news, read from its most common words
//

"use strict"

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
    pt: 'os um uma do dos das em na ao não com mais seu sua pelo pela foi são',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([language, words]) => [language, new Set(words.split(' '))]));
const MIN_HITS = 2;             // under this the text says nothing, the default is kept
const FEED_TEXTS = 30;          // the news of a feed read to tell its language
const FEED_TOLD = 1 / 3;        // the share of them that must tell one
const FEED_AGREE = 0.6;         // the share of those that must tell the same

// 'fr', 'en', 'es', 'it', 'de', or the default when the text is too short to tell
export const languageOf = (text, fallback = null) => {
    const words = (text ?? '').toLowerCase().match(/[\p{L}]+/gu) ?? [];
    let best = fallback;
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

// The language most of these texts (the news of one feed) are written in, null when too few of them
// tell it or they do not agree. Measured on 345 feeds: every feed of a known language was told right;
// a language not listed here (Czech, Polish) can still pass for English on its short words
export const feedLanguage = (texts) => {
    const counts = new Map();
    let told = 0;
    for (const text of texts.slice(0, FEED_TEXTS)) {
        const language = languageOf(text);
        if (!language) continue;
        told++;
        counts.set(language, (counts.get(language) ?? 0) + 1);
    }
    const [best, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const judged = Math.min(texts.length, FEED_TEXTS);
    return told >= judged * FEED_TOLD && count >= told * FEED_AGREE ? best : null;
};

export const LANGUAGES = Object.keys(WORDS);
