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
import {MailLabelModel} from '../../models/mail-label-model.js';

const placesOf = (text) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort().join();

// the ones translated in each language, kept while the server runs: a few words, asked once
const known = new Map();

// The labels in the reader's language (a code: 'fr', 'en'...): LABELS as they are in English, or when the AI does
// not answer; a translation that lost one of its {places} is left in English. The AI translates a word once:
// the translation is kept in the database (see MailLabelModel), so that the e-mail says the same words from one
// session of the server to the next, and the AI is asked only for the words that have none, a new one of the
// code or one it failed on (the user, 2.11.2026). The database not answering, the AI translates them all
export const labelsFor = async (language, usage = null) => {
    const to = writtenIn(language);
    if (!to || language === 'en') return LABELS;
    if (known.has(language)) return known.get(language);
    const keys = Object.keys(LABELS);
    const good = (key, translation) => Boolean(translation) && placesOf(translation) === placesOf(LABELS[key]);
    const saved = await MailLabelModel.of(language).catch(err => {
        console.error(`Mail labels: the words translated before were not read (${err.message})`);
        return new Map();
    });
    const translated = new Map(keys.filter(key => good(key, saved.get(LABELS[key]))).map(key => [key, saved.get(LABELS[key])]));
    const missing = keys.filter(key => !translated.has(key));
    if (missing.length > 0) {
        const answers = await translateTexts(missing.map(key => ({text: LABELS[key], from: 'English'})), to, usage).catch(() => missing.map(() => null));
        const fresh = missing.map((key, i) => [key, answers[i]]).filter(([key, translation]) => good(key, translation));
        fresh.forEach(([key, translation]) => translated.set(key, translation));
        if (fresh.length > 0) {
            await MailLabelModel.save(language, fresh.map(([key, translation]) => ({source: LABELS[key], translation}))).catch(err =>
                console.error(`Mail labels: the words translated were not kept (${err.message})`));
        }
    }
    if (translated.size === 0) return LABELS;
    const labels = Object.fromEntries(keys.map(key => [key, translated.get(key) ?? LABELS[key]]));
    known.set(language, labels);
    return labels;
};

// The words an article used to say it has no confirmation (see hedging.js) of the cards in another
// language than the reader's, translated: the cards with hedgedTranslation. Done when the briefing is
// written (the page shows them too, the user, 02.11.2026); the ones of a briefing written before are
// translated when its e-mail is sent
export const withHedgedTranslated = async (items, language, usage = null) => {
    const to = writtenIn(language);
    const foreign = items.filter(item => item.hedged && !item.hedgedTranslation && item.language && item.language !== language && writtenIn(item.language));
    if (!to || foreign.length === 0) return items;
    const translations = await translateTexts(foreign.map(item => ({text: item.hedged, from: writtenIn(item.language)})), to, usage)
        .catch(() => foreign.map(() => null));
    return items.map(item => foreign.includes(item) ? {...item, hedgedTranslation: translations[foreign.indexOf(item)] ?? null} : item);
};
