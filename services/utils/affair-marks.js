//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: affair-marks.js
//  Description: The marks of an event of an affair, Official, Contested and Reported, decided by an AI that READS the event: its lead title and some of
//               its news, the title and the beginning of the text of each (the user, 11.11.2026). Measured the same day on 912 events of 71 real
//               affairs, 230 of them read by two blind judges (bench/hedging/event-marks.mjs): the marks the product gave before (the AI of
//               judgeStories reading a title AND the words of five languages) were right when they showed (100%, 100%, 57%) and showed on 3.7, 0.3 and
//               0.8 events in 100; the AI that reads the event finds 4 to 6 times more
//
//  The three marks mean (the user, 11.11.2026):
//   - Official: a party this event is about issued a statement or a communiqué itself: a formal statement or a release in its own name, an official
//     announcement, a decision it publishes (the user, 11.11.2026: first "everything a party says itself", then restricted to statements and releases:
//     an interview, answers to journalists or a quote are no longer official). The AI says it AND a news of the event holds a word of a statement or
//     a communiqué (statements.js for seven languages, statement-words.js for the others: the badge only)
//   - Contested: someone named disputes the fact the event reports (a denial, a rejection, a formal challenge such as an appeal)
//   - Reported: the coverage as a whole (most of the news, not one of them) tells it as unconfirmed: unnamed sources, a rumour, "no confirmation".
//     The AI says it AND a news of the event holds a word of hedging (hedging.js): 95% right and 38% found, the AI alone 68% and 96%
//
//  What the structure of the affair counts on (a denial told apart from what it denies, a key event, the alerts: see affair-events.js) stays what it
//  was: the marks of the AI are kept in event.marks and given to the page and to the e-mail in the fields they read (see withShownMarks). An AI that
//  does not answer leaves the event as it was, and it is asked again at the next check
//

"use strict"

import {mapWithConcurrency} from './concurrency.js';
import {hasDenial} from './contested.js';
import {hedgedBy} from './hedging.js';
import {ollamaJson} from './ollama.js';
import {hasOfficialStatement} from './statement-words.js';

export const SHOWN_NEWS = 8;        // the news of an event the AI is shown
const TEXT = 240;                   // characters of the beginning of the text of a news
export const MARKS_AT_ONCE = 6;     // events in a call
const SIGNALS = 4;                  // the news a word fired on that are shown first (they hold the evidence of a mark)
const AI_CONCURRENCY = 3;

const squash = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (text, n) => text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, '')}…`;
const textOf = (item) => `${squash(item.title)}. ${squash(item.description)}`;
const hasSignal = (item) => Boolean(hedgedBy(item.title, squash(item.description)) || hasDenial(textOf(item), item.lang) || hasOfficialStatement(textOf(item)));

// The news of an event shown to the AI: the ones a word of hedging, of denial or of statement fired on first (a few), then the ones of other
// media, SHOWN_NEWS at most, each as {lang, medium, title, description}
export const shownNews = (news) => {
    const signal = news.filter(hasSignal).slice(0, SIGNALS);
    const others = news.filter(item => !signal.includes(item));
    const media = new Set(signal.map(item => item.medium));
    const distinct = others.filter(item => !media.has(item.medium) && media.add(item.medium));
    return [...signal, ...distinct, ...others.filter(item => !distinct.includes(item))].slice(0, SHOWN_NEWS)
        .map(item => ({lang: item.lang, medium: item.medium, title: squash(item.title), description: cut(squash(item.description), TEXT)}));
};

// The words an event is hedged with: the most used among its news, null when none holds one
export const hedgeOf = (news) => {
    const count = new Map();
    for (const item of news) {
        const word = hedgedBy(item.title, squash(item.description));
        if (word) count.set(word, (count.get(word) ?? 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export const marksPrompt = (events) => `An EVENT of an affair is one fact told by several articles. Below, for each event: its date, its lead title, and some of the articles that tell it (language, medium, title, beginning of the text). Answer three questions about each event.
official: true when a party this event is about (a person, a club, a federation, a body) issued a STATEMENT or a COMMUNIQUÉ itself: a formal statement or press release in its own name, an official announcement, or a decision it publishes, and at least one article reports it. False for an interview, answers to journalists, remarks or a quote of the party, an opinion; false when only journalists or sources say it.
contested: true when someone NAMED disputes the fact the event reports: says it is false, rejects it, or challenges it formally before a body (an appeal, a lawsuit, a complaint to a court or a tribunal). False for a criticism, a protest, a demand or an opinion on the event ("slams the plan", "protests the appointment", "calls for his resignation"): it does not dispute that the fact is so. False for a comment or a question.
reported: true when the coverage as a whole, most of the articles shown and not one of them, tells the event as UNCONFIRMED: it rests on unnamed or unverifiable sources, on rumour or speculation, or says it has no confirmation. False when they tell it as a fact (one cautious article among others that state it does not make it reported), also false for the "alleged" of a crime report, and for a rumour the article denies or confirms.

${events.map(({id, event, shown}) => `[${id}] ${String(event.at).slice(0, 10)} | ${event.titleTranslation ?? event.title} | ${event.news} news, ${event.media.length} media
${shown.map(item => `   - (${item.lang}, ${item.medium ?? '?'}) ${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n')}`).join('\n\n')}

Answer only in JSON: {"events": [{"id": number, "official": true or false, "contested": true or false, "reported": true or false}]}`;

// whether an event is to be asked: it has no marks, it was told to be (it grew with the news of a check), or its news doubled since its marks
export const needsMarks = (event, again = new Set()) => !event.marks || again.has(event.id) || event.news >= Math.max((event.marks.news ?? 0) * 2, (event.marks.news ?? 0) + 4);

// The events with their marks: a new list, the ones asked being new objects, the others the same ones. newsOf(event): the news the event holds
// (one without any stays as it is). again: the ids of the events to ask whatever they have. Never throws: a call that fails leaves its events
// unmarked, asked again at the next check
export const markEvents = async (events, newsOf, {usage = null, again = new Set()} = {}) => {
    const asked = events.map(event => ({event, news: newsOf(event)})).filter(({event, news}) => news.length > 0 && needsMarks(event, again));
    if (asked.length === 0) return events;
    const batches = Array.from({length: Math.ceil(asked.length / MARKS_AT_ONCE)}, (_, i) => asked.slice(i * MARKS_AT_ONCE, (i + 1) * MARKS_AT_ONCE));
    const answers = await mapWithConcurrency(batches, AI_CONCURRENCY, async (batch) => {
        const prompt = marksPrompt(batch.map(({event, news}, i) => ({id: i + 1, event, shown: shownNews(news)})));
        return ollamaJson(prompt, usage);
    });
    const marked = new Map();
    answers.forEach((result, b) => {
        if (result.status !== 'fulfilled') {
            console.error(`Affair marks: ${batches[b].length} events were not read (${result.reason?.message}), asked again at the next check`);
            return;
        }
        for (const item of Array.isArray(result.value?.events) ? result.value.events : []) {
            const one = batches[b][Number(item?.id) - 1];
            if (!one || typeof item !== 'object') continue;
            marked.set(one.event.id, {
                // a statement or a communiqué: the AI says it AND a news of the event holds the words of one (statement-words.js). The AI alone showed it on
                // 25 events in 100, 64% right; with the words on 6.7 in 100, 97% right (judged again with this definition, 11.11.2026)
                official: item.official === true && one.news.some(news => hasOfficialStatement(textOf(news))),
                contested: item.contested === true,
                // the AI says the coverage hedges AND a news of the event holds a word of hedging (the words it hedges with are shown)
                reported: item.reported === true ? hedgeOf(one.news) : null, news: one.event.news,
            });
        }
    });
    return events.map(event => marked.has(event.id) ? {...event, marks: marked.get(event.id)} : event);
};

// The events as the page and the e-mail read them: the three fields of the marks (official, denial for Contested, reported) hold the marks of the AI
// when the event has them, the ones the words gave before when it has none. A new list: what the watch counts on is not changed
export const withShownMarks = (events) => (events ?? []).map(event => event.marks
    ? {...event, official: event.marks.official, denial: event.marks.contested, reported: event.marks.reported}
    : event);
