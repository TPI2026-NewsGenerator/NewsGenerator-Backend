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

// the ones translated in each language, kept while the server runs: a few words, asked once; and the languages being translated, so that
// the previews of the editor, asked one after the other, wait for the same answer and do not each ask the AI
const known = new Map();
const pending = new Map();

// The labels in the reader's language (a code: 'fr', 'en'...): LABELS as they are in English, or when the AI does
// not answer; a translation that lost one of its {places} is left in English. The AI translates a word once:
// the translation is kept in the database (see MailLabelModel), so that the e-mail says the same words from one
// session of the server to the next, and the AI is asked only for the words that have none, a new one of the
// code or one it failed on (the user, 2.11.2026). The database not answering, the AI translates them all
export const labelsFor = async (language, usage = null) => {
    const to = writtenIn(language);
    if (!to || language === 'en') return LABELS;
    if (known.has(language)) return known.get(language);
    if (!pending.has(language)) pending.set(language, translatedLabels(language, to, usage).finally(() => pending.delete(language)));
    return pending.get(language);
};

const translatedLabels = async (language, to, usage) => {
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
// kept while the server runs, by language and words: the editor of the e-mail asks for its preview at each change, and the words of a
// card are translated once
const hedgedKnown = new Map();
const HEDGED_KEPT = 500;
export const withHedgedTranslated = async (items, language, usage = null) => {
    const to = writtenIn(language);
    const foreign = items.filter(item => item.hedged && !item.hedgedTranslation && item.language && item.language !== language && writtenIn(item.language));
    if (!to || foreign.length === 0) return items;
    const keyOf = (item) => `${language}|${item.language}|${item.hedged}`;
    const asked = foreign.filter(item => !hedgedKnown.has(keyOf(item)));
    if (asked.length > 0) {
        const translations = await translateTexts(asked.map(item => ({text: item.hedged, from: writtenIn(item.language)})), to, usage)
            .catch(() => asked.map(() => null));
        asked.forEach((item, i) => {
            // the ones the AI did not answer are asked again next time
            if (!translations[i]) return;
            if (hedgedKnown.size >= HEDGED_KEPT) hedgedKnown.delete(hedgedKnown.keys().next().value);
            hedgedKnown.set(keyOf(item), translations[i]);
        });
    }
    return items.map(item => foreign.includes(item) ? {...item, hedgedTranslation: hedgedKnown.get(keyOf(item)) ?? null} : item);
};
