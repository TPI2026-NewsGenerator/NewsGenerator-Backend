//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-reading.js
//  Description: The reading of one passage for the map of the FIFA presidency, in the three steps measured on the gold set (bench/fifa/run.mjs,
//               variant L5, 12.11.2026): 1. the CODE says whether the passage is about the association it was linked to
//               (fifa-attribution.js): if it cannot be shown the passage is left out; 2. a model reads it with the guide
//               (fifa-guide.md) and the code decides the status from its closed words (fifa-labels.js); 3. what would
//               colour the map is read again by a second model of another family, and both must say the same side, else it
//               is only uncertain ("readings_disagree"); "declared" only if both say declared. A passage the second model
//               could not read stays uncertain ("unconfirmed") and is read again later: nothing colours without it
//

"use strict"

import {readFileSync} from 'node:fs';
import process from 'node:process';
import {attribute} from './fifa-attribution.js';
import {ROLE, formProblems, statusOf} from './fifa-labels.js';

export {ROLE};
import {quoteHeld} from './stance.js';
import {ollamaJson} from './ollama.js';

const GUIDE = readFileSync(new URL('./fifa-guide.md', import.meta.url), 'utf8');
// the model that confirms what would colour: another family than the one that reads (the three readings of one model make the same errors)
export const confirmModel = () => process.env.FIFA_CONFIRM_MODEL || 'deepseek-v4-pro';

export const promptOf = ({passage, subject}, problems = null) => `${GUIDE}

---
Label this passage by the guide above. Answer with the JSON object of the label only (no other text), with exactly the fields: id, about_election, association_ok, speaker_kind, stance, toward, mark, level, status, reason, confidence, note, quote (the exact words, copied from the sentence, the title or the description, that show the stance of the association; "" when there are none), speaker (the name of who says it; "" when nobody is named).${problems ? `\n\nYour previous answer broke the rules of the guide: ${problems.join('; ')}. Correct it.` : ''}

${JSON.stringify({
    id: passage.hash, candidate: subject.name,
    association: {name: passage.member.association ?? passage.member.name, kind: passage.member.level, country: passage.member.country ?? null, fifaCode: passage.member.fifa, acronyms: passage.member.acronyms ?? []},
    matchedName: passage.matched, sentence: passage.sentence,
    article: {title: passage.article.title, description: passage.article.description, medium: passage.article.medium, language: passage.article.lang, date: passage.article.date},
}, null, 1)}`;

// one reading by a model: the label with the status the CODE decides, null when the model gave nothing usable (twice)
const readBy = async ({passage, subject}, {model, think, usage}) => {
    let problems = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const answer = await ollamaJson(promptOf({passage, subject}, problems), usage, {...(model ? {model, fallback: null} : {}), think, timeoutMs: 240000});
            const label = {...answer, id: passage.hash};
            problems = formProblems(label);
            // the status is not asked of the model: the code decides it from the closed words
            if (problems.length === 0) {
                const clean = {...label, level: ['for', 'against'].includes(label.stance) ? label.level : 'none'};
                return {...clean, ...statusOf(clean)};
            }
        } catch (error) {
            problems = [`unusable (${String(error.message).slice(0, 60)})`];
        }
    }
    return null;
};
// one reading by a model with no attribution and no second reading: what the weekly audit asks of its model
export {readBy as readWith};
const heldQuote = (label, passage) => typeof label?.quote === 'string' && label.quote.trim() !== ''
    && quoteHeld(label.quote, {title: passage.article.title, passage: `${passage.sentence}\n${passage.article.description ?? ''}`});

const result = (status, reason, label, more = {}) => ({
    status, reason, stance: label?.stance ?? 'none', level: status === 'discarded' ? 'none' : label?.level ?? 'none', speaker_kind: label?.speaker_kind ?? 'none',
    speaker: typeof label?.speaker === 'string' ? label.speaker.slice(0, 120) : '', mark: label?.mark ?? 'official', quote: typeof label?.quote === 'string' ? label.quote : '', ...more,
});

// {passage, subject: {name}} -> {status, reason, stance, level, speaker_kind, speaker, mark, quote, readBy: [models], byCode?, confirmed}
export const readPassage = async ({passage, subject}, {usage = null, firstModel = process.env.FIFA_MODEL || null, secondModel = confirmModel()} = {}) => {
    const attributed = attribute({member: passage.member, matched: passage.matched, text: `${passage.article.title}\n${passage.article.description ?? ''}\n${passage.sentence}`, lang: passage.article.lang});
    if (!attributed.ok) return result('discarded', '', null, {byCode: attributed.how, readBy: [], confirmed: false});
    const first = await readBy({passage, subject}, {model: firstModel, think: false, usage});
    if (!first) return result('uncertain', 'unconfirmed', null, {readBy: [], confirmed: false, unreadable: true});
    if (first.status !== 'established') return result(first.status, first.reason, first, {readBy: [firstModel ?? 'default'], confirmed: true});
    // the colour needs the words of the model to be in the text
    if (!heldQuote(first, passage)) return result('uncertain', 'ambiguous', first, {readBy: [firstModel ?? 'default'], confirmed: true, quoteNotHeld: true});
    const second = await readBy({passage, subject}, {model: secondModel, think: true, usage});
    if (!second) return result('uncertain', 'unconfirmed', first, {readBy: [firstModel ?? 'default'], confirmed: false});
    const readers = [firstModel ?? 'default', secondModel];
    if (second.status !== 'established' || second.stance !== first.stance || !heldQuote(second, passage)) return result('uncertain', 'readings_disagree', first, {readBy: readers, confirmed: true});
    return result('established', '', first, {level: first.level === 'declared' && second.level === 'declared' ? 'declared' : 'probable', readBy: readers, confirmed: true});
};
