//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: affair-judge.js
//  Description: What the AI says of an affair: whether the news of a card are ONE affair and how to name it,
//               then which of the stories around it belong to it, which bring a new fact, which tell the same
//               fact as another (in another language), and which report a denial or an official statement
//

"use strict"

import process from 'node:process';
import {ollamaJson} from './ollama.js';
import {dayOf} from './other-angles.js';

// The stories of an affair are found by their vectors (the thread of the card, then the closest ones of any
// language), and the vectors cannot tell an affair from the field around it: on the affair of UEFA against
// Infantino (4.11.2026, 70 stories of 30 days) "40 African nations can now host matches at home" was 0.86
// from the card, the same as the reaction of Norway. So the AI reads them against a file of the affair, which
// says what it covers and what it does not, and answers "in doubt, no": a wrong story in an affair is a
// wrong notification for whoever follows it
export const FACTS_SHOWN = 8;       // the news of its thread given to name the affair, the card's closest first
export const JUDGED_AT_ONCE = 40;   // stories judged in one call, oldest first: a fact told in two languages is in one call
const TITLE_WORDS = 14;

export const affairFilePrompt = (title, facts, language) => `A news card: "${title}"
News the grouping of the system put with it as one affair, oldest first, each with its day:
${facts.map(fact => `- ${dayOf(fact.at) ? `(${dayOf(fact.at)}) ` : ''}${fact.title}`).join('\n')}

Is this ONE affair: a single story with a defined subject that unfolds over days in steps, each news telling a step
of it (a dispute, a scandal, an investigation, a legal case, a negotiation, an election race, a crisis, a
transfer saga, a ban)? It is NOT an affair when the news only share a field or a kind of event: the matches or
rounds of a competition, the daily report of a market or of the weather, the many unrelated stories of one
person, a series of one medium, a list of results.
Answer in JSON only: {"affair": true or false, "title": "...", "about": "...", "not": "..."}
"title": in ${language}, ${TITLE_WORDS} words at most, the name of the whole affair: its subject and what is at stake, not the fact of
the day (the card says that), with the names of the news; no judgment, no question, no exclamation mark, no teaser.
Write the names and the acronyms (AFCON, CAF, FMF...) exactly as the news write them: never spell one out, never add
a name or a place they do not give.
"about": one sentence, in English, on what the affair covers: its parties and its stake.
"not": one sentence, in English, on what is NOT part of it although it names the same people or the same field.`;

// {affair, title, about, not}: the file of an affair, null when the AI says it is no affair or answers
// something unusable. A title is kept only if every capitalized word of it is in the news it was written from
// (the AI wrote names that were not there); else the title of the card stands for it
const words = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// the capitalized words of a title but its first ("L'UEFA" gives UEFA, "FIFA's" gives FIFA)
const capitalized = (title) => [...String(title).matchAll(/(?<![\p{L}\p{N}])(\p{Lu}[\p{L}\p{N}-]{2,})/gu)].map(match => match[1]).slice(1);

export const normalizeFile = (answer, cardTitle, facts) => {
    if (answer?.affair !== true) return null;
    const known = words([cardTitle, ...facts.map(fact => fact.title)].join(' '));
    const own = typeof answer.title === 'string' ? answer.title.replace(/\s+/g, ' ').trim() : '';
    const usable = own.length >= 8 && own.split(/\s+/).length <= TITLE_WORDS + 4 && !/[!?]\s*$/.test(own)
        && capitalized(own).every(name => known.includes(words(name)));
    return {
        title: usable ? own : cardTitle,
        written: usable,
        proposed: own,
        about: typeof answer.about === 'string' ? answer.about.trim().slice(0, 400) : '',
        not: typeof answer.not === 'string' ? answer.not.trim().slice(0, 400) : '',
    };
};

// facts: [{title, at}], the card's thread: its own title first. usage: see newUsage
export const affairFileOf = async (title, facts, {language, usage = null}) =>
    normalizeFile(await ollamaJson(affairFilePrompt(title, facts, language), usage), title, facts);

export const judgePrompt = (file, facts, items) => `An affair a reader follows: "${file.title}"
What it covers: ${file.about || '(not said)'}
What it does NOT cover: ${file.not || '(not said)'}${facts.length > 0 ? `
Facts of it already known:
${facts.map(fact => `- ${dayOf(fact.at) ? `(${dayOf(fact.at)}) ` : ''}${fact.title}`).join('\n')}` : ''}

News published around it, oldest first, each with its day and language:
${items.map((item, i) => `[${i + 1}] (${dayOf(item.at)}, ${item.lang}) ${item.title || '(no title)'}`).join('\n')}

For each news:
"in": true when it is part of THIS affair: a step of it, a reaction to it, a consequence, a statement of one of its
  parties about it, or the background that explains it. One person, company or body named in both is not enough,
  nor the same field: another matter of the same people is "in": false. A wrong one wakes the reader for
  nothing: in doubt, false.
"kind": "key" when it brings a NEW FACT to the affair: a decision, an announcement, a revelation, a ruling, a
  resignation, a candidacy, a sanction, a vote, a denial, a figure that changes where the affair stands.
  "minor" for the rest: an opinion, a comment, a preview, a recap, a reaction without news, the same fact with one
  more detail.
"as": the number of an EARLIER news of this list that tells the same fact (the same step, told by another
  medium or in another language), else null.
"says": "denial" when the news reports a named party denying or rejecting what the affair alleges; "official"
  when the party the news is about announces it itself (its statement, its release, a decision it publishes);
  else null.
Answer in JSON only: {"news": [{"n": 1, "in": true, "kind": "key", "as": null, "says": null}]}`;

// The verdicts of the AI on 'items' (as given to judgePrompt), one per item, in their order; an item the AI
// did not answer is out. as: the index of an earlier item judged in, never itself or a later one
export const normalizeJudged = (answer, items) => {
    const byNumber = new Map((Array.isArray(answer?.news) ? answer.news : [])
        .map(item => [Number(item?.n) - 1, item]).filter(([i]) => Number.isInteger(i) && i >= 0 && i < items.length));
    const verdicts = items.map((_, i) => {
        const item = byNumber.get(i);
        return {
            in: item?.in === true,
            kind: item?.kind === 'key' ? 'key' : 'minor',
            as: Number.isInteger(Number(item?.as)) && item?.as !== null ? Number(item.as) - 1 : null,
            says: item?.says === 'denial' || item?.says === 'official' ? item.says : null,
        };
    });
    return verdicts.map((verdict, i) => ({...verdict, as: verdict.as !== null && verdict.as >= 0 && verdict.as < i && verdicts[verdict.as].in ? verdict.as : null}));
};

// items: [{title, at, lang}] oldest first. Answers the verdicts of normalizeJudged; a call failing throws
export const judgeStories = async (file, facts, items, usage = null) =>
    normalizeJudged(await ollamaJson(judgePrompt(file, facts, items), usage), items);

// The judgment above joins the stories of one call that tell one fact; the same fact told the next hour, in the
// next call, or with another angle stays two events (the tax bill of Infantino was three on 4.11.2026). So the
// events themselves are read once more, all together, titles only
export const MAX_EVENTS_COMPARED = 150;
export const sameFactPrompt = (file, events) => `The events of an affair a reader follows: "${file.title}", oldest first, each with its day:
${events.map((event, i) => `[${i + 1}] (${dayOf(event.at)}, ${event.language}) ${event.title}`).join('\n')}

Some of these events tell the SAME fact: the same announcement, revelation, decision, ruling or statement, told
by other media, in another language, some hours later, or with one more detail. Two STEPS of one affair are not
the same fact: a decision and the reaction to it, a question and its answer, a complaint and its denial, a
suspension and its softening, a report and the denial of it.
List the groups of events that tell the same fact, each group by the numbers of its events. Only groups of two
or more. Answer in JSON only: {"same": [[3, 4], [10, 11, 12]]}`;

// The groups of event indexes (from 0) the AI says tell one fact: of two or more, each event in one group
export const normalizeSame = (answer, count) => {
    const taken = new Set();
    return (Array.isArray(answer?.same) ? answer.same : []).flatMap(group => {
        const ids = [...new Set((Array.isArray(group) ? group : []).map(n => Number(n) - 1))]
            .filter(i => Number.isInteger(i) && i >= 0 && i < count && !taken.has(i));
        if (ids.length < 2) return [];
        ids.forEach(i => taken.add(i));
        return [ids.sort((a, b) => a - b)];
    });
};

export const sameFactEvents = async (file, events, usage = null) =>
    events.length < 2 ? [] : normalizeSame(await ollamaJson(sameFactPrompt(file, events.slice(0, MAX_EVENTS_COMPARED)), usage), Math.min(events.length, MAX_EVENTS_COMPARED));

// A key event is not yet an alert: a phone that rings for nothing is worse than a late one (the user, 4.11.2026:
// the precision must be high). Each key event found by the watch is read once more by the AI, thinking on, against
// what the reader already knows: only a new fact that changes where the affair stands rings. As the second opinion
// on the neutral titles did: it stopped the 28 mild and bad rewrites of 59 and let through the 22 right ones
export const confirmPrompt = (file, known, events) => `An affair a reader follows: "${file.title}"
What it covers: ${file.about || '(not said)'}
What it does NOT cover: ${file.not || '(not said)'}
What the reader already knows (the latest facts, and what they were already told by notification):
${known.length > 0 ? known.map(event => `- (${dayOf(event.at)}) ${event.titleTranslation ?? event.title}`).join('\n') : '- (nothing yet)'}

New developments just found, each with its day and the media that tell it:
${events.map((event, i) => `[${i + 1}] (${dayOf(event.at)}, ${event.media.length} media${event.official ? ', announced by the party' : ''}${event.denial ? ', a denial' : ''}) ${event.titleTranslation ?? event.title}`).join('\n')}

For each one, decide whether the reader should be told RIGHT NOW, as a notification on their phone. It must be both:
1. About THIS affair itself: a step of what it covers. NOT another matter that names the same people or body (another
   dispute, another scandal, an internal affair of another organisation), however close it is.
2. A NEW FACT that changes where the affair stands: a decision, an announcement, a revelation, a ruling, a resignation,
   a candidacy, a sanction, a vote, an official denial or reaction that is news in itself, a figure.
"notify": false for a comment, an opinion, an analysis, a preview, a recap, a reaction without news, a minor step, and
for the same fact as one the reader knows told again, in other words, with one more detail or by someone else (a
candidate already told is not told again because another person talks of him).
The same kind of fact as ones the reader was already told, happening to one more country, company or person (one more
shop hit, one more country affected), is NOT new unless it changes the nature or the scale of the affair (the identity
of those behind it, an arrest, a claim, an official measure, a financial figure, a new kind of target).
In doubt: false. A notification for nothing is worse than a late one.
Answer in JSON only: {"news": [{"n": 1, "notify": true}]}`;

// one boolean per event, in order: true only for the ones the AI said true to
export const normalizeConfirmed = (answer, count) => {
    const said = new Map((Array.isArray(answer?.news) ? answer.news : []).map(item => [Number(item?.n) - 1, item?.notify === true]));
    return Array.from({length: count}, (_, i) => said.get(i) === true);
};

// Measured on the 11 alerts of the replay of the UEFA-Infantino affair over 10 days (bench/affairs/confirm-bench.mjs, read by
// hand: 5 right, 4 borderline, 2 wrong), each asked with what the reader was told before it. The first prompt, gemma4:31b:
// 4 right kept, 2 borderline, 1 wrong (the AFC discipline of a prince). With the condition "about this affair itself" and
// the alerts already sent among what the reader knows: 4 right, 2 borderline, none wrong (gemma4:31b), 3 right, 1 borderline,
// none wrong (deepseek-v4-pro, stricter: it also stopped a candidate told for the first time). The model of the other calls
// is kept; AFFAIR_CONFIRM_MODEL names another one.
// A wave that spreads (the cyberattacks on the supermarkets of Europe, 10 alerts in 2 days, bench/affairs/confirm-bench-cyber.mjs):
// the prompt above let all 10 through, 5 of them one more country or company of the same wave. With "the same kind of fact
// happening to one more country, company or person is not new unless it changes the nature or the scale": 3 of 10 (the spread
// beyond France, the identity of the hackers, the forecast of a company), none of the 5; it also stopped two the reader may
// have wanted (Germany, the British meat firms), which stay in the page, on the line. On the Infantino alerts it changed nothing
// (4 right of 5, no borderline, no wrong, in both runs of that session)
export const CONFIRM_MODEL = process.env.AFFAIR_CONFIRM_MODEL || undefined;
export const confirmEvents = async (file, known, events, usage = null, {model = CONFIRM_MODEL, prompt = confirmPrompt} = {}) =>
    events.length === 0 ? [] : normalizeConfirmed(await ollamaJson(prompt(file, known, events), usage, {think: true, model}), events.length);
