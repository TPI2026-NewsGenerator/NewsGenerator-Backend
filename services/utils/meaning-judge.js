//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: meaning-judge.js
//  Description: Which texts are on a subject, by meaning: the judge given to findFeeds by the
//               discovery of the sources of a profile and by the search of the web
//

"use strict"

import {embed, denseSimilarity} from "./embedder.js";

// A news is on an interest when its cosine with the interest reaches this. Calibrated on the titles
// judged by hand: it keeps 57% of the fully relevant ones and 11% of the others, which is enough to
// tell a section from a general feed. Judging by keywords written by the AI changed from one run to
// the next; the meaning did not.
export const JUDGE_THRESHOLD = 0.45;

// texts -> [true when on one of the subjects]. subjectDenses: the bge-m3 vectors of the subjects.
// Texts seen for a medium are often seen again (its main feed), they are encoded once in 'cache'
export const judgeOf = (subjectDenses, cache = new Map()) => async (texts) => {
    const missing = [...new Set(texts.filter(text => !cache.has(text)))];
    if (missing.length > 0) {
        (await embed(missing)).forEach((vector, i) => cache.set(missing[i], vector.dense));
    }
    return texts.map(text => subjectDenses.some(dense => denseSimilarity(cache.get(text), dense) >= JUDGE_THRESHOLD));
};
