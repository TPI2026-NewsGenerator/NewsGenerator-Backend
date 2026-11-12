//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-discovery.js
//  Description: The candidates of the FIFA presidency the news name, found without a reader adding them (an association "nominated" a person, a person "will run for the
//               presidency of FIFA"). The rules of the steps: the sentences of the news that hold FIFA, a word of president and a word of candidacy; the persons the tagger
//               linked to an item of Wikidata that are named in them; what two models say of each person from a few of those sentences; and the code's verdict (both must
//               say it, in enough media). Pure: the news and the readings come in, the persons and the verdicts go out. Measured on the 30 days of news the 12.11.2026
//               (bench/fifa/discover.mjs): the words alone find the real candidates and also Blatter, a Nigerian presidential candidate and Macron, so nothing is added
//               without the two readings
//

"use strict"

import {norm, sentencesOf, spanOf} from './fifa-passages.js';
import {quoteHeld} from './stance.js';

// The three words a sentence must hold, as stems of a regular expression that Postgres and JavaScript read the same (no word edge, no class: they only choose the
// news to read, the AI decides). Case ignored
export const DISCOVERY_REGEX = {
    fifa: 'fifa',
    president: 'presiden|président|präsident|presidente|presidenza|voorzitter|prezydent|prezident|başkan|председател|президент|رئيس|主席|会長|회장',
    candidacy: 'candidat|kandidat|kandydat|nominat|nominé|nominee|nominiert|nomina|run for|runs for|running for|stand for|standing for|bid for|vie for|succeed|successor|challenger|se présenter|présenter sa|postul|aspir|concorr|herausford',
};

// the media a person must be named as a candidate in, by what the two readings say: an announced or nominated candidate in two media, a rumour in five
export const MIN_MEDIA = {declared: 2, rumoured: 5};
export const SAMPLES = 6;                       // the sentences read for a person, from different media

const compiled = Object.fromEntries(Object.entries(DISCOVERY_REGEX).map(([name, source]) => [name, new RegExp(source, 'iu')]));

// the sentences of a text that hold all three words
export const candidateSentences = (text) => sentencesOf(text).filter(sentence => compiled.fifa.test(sentence) && compiled.president.test(sentence) && compiled.candidacy.test(sentence));

// The persons named in a sentence among the ones the tagger linked in the article ([{qid, name}]): by their full name, or by the last word of it (4 letters at least)
// when no other person of the article ends with the same word. Each person once
export const personsIn = (sentence, names) => {
    const small = norm(sentence);
    const lastWord = (name) => norm(name).split(' ').pop();
    const seen = new Set();
    const found = [];
    for (const person of names) {
        if (seen.has(person.qid)) continue;
        const full = norm(person.name);
        const last = lastWord(person.name);
        const shared = names.some(other => other.qid !== person.qid && lastWord(other.name) === last);
        if ((full.length >= 5 && spanOf(small, full) >= 0) || (!shared && last.length >= 4 && spanOf(small, last) >= 0)) {
            seen.add(person.qid);
            found.push({qid: person.qid, name: person.name});
        }
    }
    return found;
};

// The persons named in the candidacy sentences of the news: Map(qid -> {qid, name, media: Set, articles: Set, samples: [{medium, language, date, sentence}]}). news: [{id, title,
// description, text, lang, medium, at}] (the newest first gives the newest samples); persons: [{id, qid, name}] the tagger linked in them; skip: the qids not to look for
export const collectPersons = ({news, persons, skip = new Set()}) => {
    const namesOf = new Map();
    for (const row of persons) namesOf.set(row.id, [...(namesOf.get(row.id) ?? []), {qid: row.qid, name: row.name}]);
    const found = new Map();
    for (const item of news) {
        const names = namesOf.get(item.id) ?? [];
        if (names.length === 0) continue;
        for (const sentence of candidateSentences(item.text ?? `${item.title} | ${item.description ?? ''}`)) {
            for (const person of personsIn(sentence, names)) {
                if (skip.has(person.qid)) continue;
                const kept = found.get(person.qid) ?? {qid: person.qid, name: person.name, media: new Set(), articles: new Set(), samples: []};
                kept.media.add(item.medium);
                kept.articles.add(item.id);
                if (kept.samples.length < SAMPLES && !kept.samples.some(sample => sample.medium === item.medium)) {
                    kept.samples.push({medium: item.medium, language: item.lang ?? null, date: new Date(item.at).toISOString().slice(0, 10), sentence: sentence.replace(/\s+/g, ' ').slice(0, 400)});
                }
                found.set(person.qid, kept);
            }
        }
    }
    return found;
};

// what a model is asked about a person: the sentences are all it sees
export const promptOfCandidate = ({name, samples}) => `You decide whether a person is a candidate for the presidency of FIFA (the election of the president of the international football federation FIFA) from sentences of the news.

Answer with the JSON object only, no other text: {"status": "declared" | "rumoured" | "no", "quote": "..."}

- "declared": the person announced it, or an association or a confederation officially nominated or put forward the person as a candidate for the FIFA presidency (a candidacy that exists, even if the election is later).
- "rumoured": the news only say the person MAY run: considered, approached, urged to run, "potential candidate", "has not said whether he will stand".
- "no": anything else. The person criticises or supports the president or a candidate, is the president now or was one, is a candidate in ANOTHER election (a country, a club, a national federation, another body), the sentences are not about THIS person, or the person withdrew.
quote: the exact words, copied from ONE of the sentences, that show it ("" when "no").

Person: ${name}
Sentences (each from a different medium):
${samples.map((sample, at) => `${at + 1}. [${sample.medium}, ${sample.language ?? '?'}] ${sample.sentence}`).join('\n')}`;

// the answer of a model as a closed word, null when it is none; "declared" or "rumoured" without words held in the sentences is "no"
export const judgmentOf = (answer, samples) => {
    if (!answer || typeof answer !== 'object' || !['declared', 'rumoured', 'no'].includes(answer.status)) return null;
    if (answer.status === 'no') return {status: 'no', quote: ''};
    const quote = typeof answer.quote === 'string' ? answer.quote.trim() : '';
    if (!quoteHeld(quote, {title: '', passage: samples.map(sample => sample.sentence).join('\n')})) return {status: 'no', quote: '', unheld: true};
    return {status: answer.status, quote};
};

// The verdict of the code on the two readings and the media: add the person, as "declared" only when both say declared, else "rumoured"; "no" from either one is no
// {add, status?, quote?, why}. A reading that is missing (the model did not answer) adds nobody: the person is judged again at the next run
export const candidateVerdictOf = ({first, second, media}) => {
    if (!first || !second) return {add: false, why: 'unread'};
    if (first.status === 'no' || second.status === 'no') return {add: false, why: 'not_a_candidate'};
    const status = first.status === 'declared' && second.status === 'declared' ? 'declared' : 'rumoured';
    if (media < MIN_MEDIA[status]) return {add: false, why: 'too_few_media', status};
    return {add: true, status, quote: first.quote, why: ''};
};
