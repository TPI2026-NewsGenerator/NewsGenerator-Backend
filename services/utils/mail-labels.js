//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: mail-labels.js
//  Description: The words of the e-mail of a briefing around what its cards say ("Key points",
//               "Contested", "Read the article at"...) in the reader's language, translated as the
//               titles of the news are (the user, 18.10.2026: all of the e-mail in the reader's language)
//

"use strict"

import {translateTexts} from './extract.js';
import {writtenIn} from './language.js';
import {LABELS} from './briefing-mail.js';

const placesOf = (text) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort().join();

// the ones translated in each language, kept while the server runs: a few words, asked once
const known = new Map();

// The labels in the reader's language (a code: 'fr', 'en'...): LABELS as they are in English, or when
// the AI does not answer; a translation that lost one of its {places} is left in English
export const labelsFor = async (language, usage = null) => {
    const to = writtenIn(language);
    if (!to || language === 'en') return LABELS;
    if (known.has(language)) return known.get(language);
    const keys = Object.keys(LABELS);
    const translations = await translateTexts(keys.map(key => ({text: LABELS[key], from: 'English'})), to, usage).catch(() => keys.map(() => null));
    if (translations.every(translation => !translation)) return LABELS;
    const labels = Object.fromEntries(keys.map((key, i) => [key,
        translations[i] && placesOf(translations[i]) === placesOf(LABELS[key]) ? translations[i] : LABELS[key]]));
    known.set(language, labels);
    return labels;
};

// The words an article used to say it has no confirmation (see hedging.js) of the cards in another
// language than the reader's, translated: the cards with hedgedTranslation
export const withHedgedTranslated = async (items, language, usage = null) => {
    const to = writtenIn(language);
    const foreign = items.filter(item => item.hedged && item.language && item.language !== language && writtenIn(item.language));
    if (!to || foreign.length === 0) return items;
    const translations = await translateTexts(foreign.map(item => ({text: item.hedged, from: writtenIn(item.language)})), to, usage)
        .catch(() => foreign.map(() => null));
    return items.map(item => foreign.includes(item) ? {...item, hedgedTranslation: translations[foreign.indexOf(item)] ?? null} : item);
};
