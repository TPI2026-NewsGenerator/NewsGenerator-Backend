//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: stance.js
//  Description: What a passage of a news says of the position of a football association on a person (the incumbent
//               of FIFA, a candidate): read by the AI one passage at a time, in closed words, then checked and
//               decided by the code. The AI says who speaks, how plainly and for whom; the code says whether it
//               binds the association and whether the position is declared or only probable (see the doc of the
//               API of the positions, "L'objet position"). Measured on the real cases of
//               tests/regression/stance-corpus.json (bench/federations/stance-bench.mjs)
//

"use strict"

import {ollamaJson} from './ollama.js';

// who speaks, in the words the AI answers with. Only the first three bind the association: a vice-president, a former
// or honorary president, the candidate himself or anyone else speak for themselves
export const SPEAKER_KINDS = ['president', 'executive', 'statement', 'deputy', 'former', 'candidate', 'other'];
export const BINDING = new Set(['president', 'executive', 'statement']);
export const STANCES = ['for', 'against', 'undecided', 'none'];
export const TOWARD = ['person', 'other', 'nobody'];
export const MARKS = ['official', 'reported', 'denied'];

// the text as it is compared: no accents, small letters, one kind of quote, one space
const plain = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’‘`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/\s+/g, ' ').trim();

// The prompt: one passage, one association, one person. The association is given with the other ways it is written
// (FMF, JFA): the news names it so, and the same letters are another association's elsewhere, which the passage tells
export const stancePrompt = ({subject, association, article}) => `You read a passage of a news article to know whether a football association has taken a position on a person.

The association: ${association.name}${association.country ? ` (${association.country})` : ''}${association.aliases?.length ? `, also written: ${association.aliases.join(', ')}` : ''}. It speaks through its president, its executive committee, its general secretary or chief executive, its spokesperson, its statements and its website.
The person asked about: ${subject.name}.

Article (${article.medium}, ${article.date}): "${article.title}"${article.passage ? `\nPassage: "${article.passage}"` : ''}

Answer about THIS association and THIS person only.
about_association: true only when the text reports what this association itself, or someone speaking for it, said, decided, voted or did about the person. false when the association is only named (a place, a host, a member), when someone asks or urges it to do something, when another person or body says things about it, when the name or the initials could be another association (another country), and when the text is about something else than the person (a tournament, a stadium, an accusation).
speaker: who says it, by name; "" when nobody is named.
speaker_kind: one of
  "president" (the current president or chairman of this association),
  "executive" (its committee, board, general secretary, chief executive or spokesperson),
  "statement" (the association itself: its statement, release, website, decision, or "the federation says"),
  "deputy" (a vice-president or another officer of the association),
  "former" (a former or honorary president or official),
  "candidate" (the speaker is the person asked about, speaking for himself),
  "other" (a journalist, a pundit, an agent, an unnamed source, another body, anyone else).
stance: "for" when they back, support or want the person (to stay, to be elected); "against" when they oppose, criticise, want the person gone or will not support them; "undecided" when they say it is too early, have not chosen or only weigh it; "none" when no stance toward the person appears.
toward: "person" when the stance is toward the person asked about, "other" when it is toward someone else (a rival), "nobody" when there is none.
explicit: true only when they say plainly that they support or oppose, will vote, or ask the person to go or to stay; false for praise, thanks, criticism, doubts, regrets or a hint.
mark: "reported" only when the text itself hedges: an unnamed source, "reportedly", "according to", "would", "is said to", "could", "weighs". Otherwise "official": what a named person or body says, demands, decides or does, told plainly, is official even when a journalist writes it without quotation marks. "denied" when they deny it.
quote: the exact words of the text that show it, copied; "" when none.
Answer in JSON only: {"about_association": true, "speaker": "", "speaker_kind": "other", "stance": "none", "toward": "nobody", "explicit": false, "mark": "official", "quote": ""}`;

// whether the words the AI quotes are in the text: each part of a quote cut with "…" or "..." must be, and one at least
export const quoteHeld = (quote, article) => {
    const text = plain(`${article.title}\n${article.passage ?? ''}`);
    const parts = plain(quote).split(/…|\.{3}/).map(part => part.trim()).filter(part => part.length >= 6);
    return parts.length > 0 && parts.every(part => text.includes(part));
};

// the answer of the AI as the closed words it must be, null when it is not (a word that is none of the list is no answer)
export const readingOf = (answer, article) => {
    if (!answer || typeof answer !== 'object') return null;
    const kind = String(answer.speaker_kind ?? '').toLowerCase();
    const stance = String(answer.stance ?? '').toLowerCase();
    const toward = String(answer.toward ?? '').toLowerCase();
    const mark = String(answer.mark ?? '').toLowerCase();
    if (typeof answer.about_association !== 'boolean' || !SPEAKER_KINDS.includes(kind) || !STANCES.includes(stance)
        || !TOWARD.includes(toward) || !MARKS.includes(mark) || typeof answer.explicit !== 'boolean') return null;
    const quote = typeof answer.quote === 'string' ? answer.quote.trim() : '';
    return {
        about: answer.about_association,
        speaker: typeof answer.speaker === 'string' ? answer.speaker.trim() : '',
        speakerKind: kind, stance, toward, explicit: answer.explicit, mark, quote,
        quoteHeld: quote !== '' && quoteHeld(quote, article),
    };
};

// What the code makes of a reading: {signal: true, position, binds} or {signal: false, why}.
// A position needs the association to be the one speaking about this person, a stance for or against, and words
// that are really in the text. Declared only when the speaker binds the association, says it as their own word and
// says it plainly; else probable. A candidate speaking for himself gives his association nothing; a denial is no
// stance (v0: it will be read with what it denies)
export const positionOf = (reading) => {
    if (reading === null) return {signal: false, position: null, why: 'unreadable'};
    if (!reading.about) return {signal: false, position: null, why: 'not_about_association'};
    if (reading.speakerKind === 'candidate') return {signal: false, position: null, why: 'candidate_himself'};
    if (reading.toward !== 'person') return {signal: false, position: null, why: 'not_toward_person'};
    if (reading.stance !== 'for' && reading.stance !== 'against') return {signal: false, position: null, why: `stance_${reading.stance}`};
    if (reading.mark === 'denied') return {signal: false, position: null, why: 'denied'};
    if (!reading.quoteHeld) return {signal: false, position: null, why: 'quote_not_found'};
    const binds = BINDING.has(reading.speakerKind);
    const declared = binds && reading.mark === 'official' && reading.explicit;
    return {signal: true, binds, position: `${reading.stance === 'for' ? 'soutien' : 'non_soutien'}_${declared ? 'declare' : 'probable'}`};
};

// item: {subject: {name}, association: {name, country, aliases}, article: {title, passage, medium, date}} ->
// {reading, decision}; options as ollamaJson (model, think, timeoutMs)
export const readStance = async (item, usage = null, options = {}) => {
    const reading = readingOf(await ollamaJson(stancePrompt(item), usage, options), item.article);
    return {reading, decision: positionOf(reading)};
};
