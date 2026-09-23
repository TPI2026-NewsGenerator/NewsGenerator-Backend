//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: hedging.js
//  Description: Words a newspaper uses to say it has no confirmation of what it reports
//

"use strict"

// This does not judge whether a news is true. It reports how the article presents itself: a paper
// writing "reportedly" or "selon des sources" is telling its reader it could not confirm. A scoop
// from one serious newspaper carries none of these, and a rumour repeated everywhere carries them
// all, which is exactly why this is shown next to the number of media and not mixed into it.
//
// Conditionals ("aurait dit", "would be") are left out on purpose: French and Italian use them for
// ordinary reported speech, so they would mark almost every article.
const MARKERS = [
    // English
    'reportedly', 'according to sources', 'according to reports', 'sources say', 'sources told',
    'is said to', 'are said to', 'understood to be', 'it is understood', 'rumour', 'rumor',
    'speculation', 'unconfirmed', 'allegedly', 'people familiar with',
    // French
    'selon des sources', 'selon nos informations', 'selon des informations', 'croit savoir',
    'rumeur', 'non confirmé', 'aurait été', 'd’après des sources', "d'après des sources",
    // Spanish
    'según fuentes', 'fuentes cercanas', 'al parecer', 'presuntamente', 'rumor', 'sin confirmar',
    // German
    'berichten zufolge', 'insidern zufolge', 'angeblich', 'gerüchte', 'unbestätigt',
    // Italian
    'secondo fonti', 'secondo indiscrezioni', 'indiscrezioni', 'si vocifera', 'presunto', 'non confermato',
];

// the markers as one regular expression, the longest first so "according to sources" is preferred
// over a shorter one inside it
const escape = (marker) => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = new RegExp(
    '(' + [...MARKERS].sort((a, b) => b.length - a.length).map(escape).join('|') + ')',
    'i'
);

// the words the article used to hedge, null when it states its news plainly
export const hedgedBy = (...texts) => {
    const found = PATTERN.exec(texts.filter(Boolean).join(' '));
    return found ? found[1].toLowerCase() : null;
};
