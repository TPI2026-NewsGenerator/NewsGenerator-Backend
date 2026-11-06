//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: title-translation.js
//  Description: The titles of news in the language of the reader, for the places that show a title among others (the events of an
//               affair, the other angles of a card): the language of each is read from its letters, not only from the label of its feed
//

"use strict"

import {translateTexts} from './extract.js';
import {languageCodeOf, titleLanguage, writtenIn} from './language.js';

// In calls of 25, as the briefing translates: one call for 50 titles came back short and gave none
const AT_ONCE = 25;

// the title without what a translation changes by itself: its case, its quotes and punctuation, its accents
const plain = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// items: [{title, label}], label the language the database gave the news (a code), language: the reader's (a code). Answers one
// {language, translation} per item: language the one the title is written in, translation its title in the reader's language, null
// when it is in that language already, or could not be translated safely. A title in another language than its label says, and in
// Latin letters, is a guess (see titleLanguage): its translation is kept only if it differs from the title, so an English title with
// accents on a name stays as it is. The AI that translates a title whose language was only guessed says the language it is really
// written in, and it counts: a Slovenian title of names that franc read Bosnian has the badge of Slovenian, a Polish one that was read
// Catalan too (the corpus of tests/regression)
export const translatedTitles = async (items, language, usage = null) => {
    const to = writtenIn(language);
    const read = items.map(item => ({...titleLanguage(item.title, item.label), title: item.title, label: item.label}));
    const wanted = read.map((one, i) => i).filter(i => to && read[i].language && read[i].language !== language && writtenIn(read[i].language));
    const answers = new Map();
    const said = new Map();
    for (let start = 0; start < wanted.length; start += AT_ONCE) {
        const part = wanted.slice(start, start + AT_ONCE);
        const languages = [];
        const translations = await translateTexts(part.map(i => ({text: read[i].title, from: writtenIn(read[i].language), ...(read[i].guessed ? {guess: true} : {})})), to, usage, {languages})
            .catch(() => part.map(() => null));
        part.forEach((i, j) => {
            answers.set(i, translations[j]);
            const code = languageCodeOf(languages[j]);
            if (code) said.set(i, code);
        });
    }
    return read.map((one, i) => {
        const translation = answers.get(i) ?? null;
        const written = one.guessed && said.has(i) ? said.get(i) : one.language;
        // a title that is the same once translated, or that the AI says is the language of the reader, was no foreign title (names with accents)
        if (translation && one.guessed && (plain(translation) === plain(one.title) || written === language)) return {language: one.label, translation: null};
        return {language: written, translation};
    });
};
