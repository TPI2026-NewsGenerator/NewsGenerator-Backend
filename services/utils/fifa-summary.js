//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: fifa-summary.js
//  Description: The summary of the sheet of an association on the map of the FIFA presidency, to help a reader understand where it stands. The summary the CODE builds (fifa-map.js
//               summaryOf, contextOf) is the base: nothing in it is written by an AI. This file turns it into NUMBERED FACTS (a position, a sentence of the news word for word, what the
//               confederation and the other associations of it say), asks a model to write a few claims from them on demand, and checks what comes back: every claim cites facts
//               that exist and holds no figure that is not in them. A claim that fails is dropped. Pure: the summary comes in, the facts, the prompt and the claims go out
//

"use strict"

import {createHash} from 'node:crypto';

const MAX_FACTS = 30;
const MAX_CLAIMS = 5;
const LEVEL = {declared: 'declared', probable: 'probable'};

const day = (date) => new Date(date).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "soutien_declare" -> {side: "for", level: "declared"}
const readPosition = (position) => ({side: String(position).startsWith('non_') ? 'against' : 'for', level: String(position).endsWith('declare') ? 'declared' : 'probable'});

// The numbered facts of a sheet: [{id, kind: 'position' | 'sentence' | 'confederation', text, url?, medium?, date?}], at most 30. The text of a sentence is the sentence of the news itself.
// member: {name}; summary: summaryOf of fifa-map.js; context: contextOf of fifa-map.js or null
export const factsOf = ({member, summary, context = null}) => {
    const facts = [];
    const add = (fact) => { if (facts.length < MAX_FACTS) facts.push({id: facts.length + 1, ...fact}); };
    for (const candidate of summary?.candidates ?? []) {
        if (candidate.position !== 'inconnue') {
            const {side, level} = readPosition(candidate.position);
            const how = candidate.human ? `set by a reader (${candidate.human.by})` : `read from the news`;
            add({kind: 'position', text: `${member.name} is shown ${side === 'for' ? 'for' : 'against'} ${candidate.name} at the ${LEVEL[level]} level since ${day(candidate.since)}, ${how}: `
                + `${noun(candidate.signals_count, 'established signal', 'established signals')}, ${noun(candidate.media_30d, 'medium', 'media')} in the last 30 days${candidate.stale ? ', older than 90 days' : ''}${candidate.changed ? ', it changed side before' : ''}.`});
        } else {
            add({kind: 'position', text: `${member.name} has no established position on ${candidate.name}: ${noun(candidate.uncertain_count, 'sentence', 'sentences')} about the election and the association that say no position.`});
        }
        for (const side of candidate.sides) {
            for (const key of side.key) {
                const speaker = key.speaker ? `${key.speaker}${key.role ? ` (${key.role}${key.binds ? ', speaks for the association' : ''})` : ''}` : 'a speaker not named';
                add({kind: 'sentence', text: `${day(key.published_at)}, ${key.medium}, ${side.stance === 'for' ? 'for' : 'against'} ${candidate.name}, said by ${speaker}: "${String(key.sentence).replace(/\s+/g, ' ').trim()}"`,
                    url: key.url, medium: key.medium, date: key.published_at});
            }
        }
    }
    const confederation = context?.confederation;
    if (confederation) {
        for (const candidate of summary?.candidates ?? []) {
            const own = context.own?.[candidate.subject_qid];
            const others = context.associations?.[candidate.subject_qid];
            const parts = [];
            if (own) { const {side, level} = readPosition(own.position); parts.push(`${confederation.fifa} itself is shown ${side} ${candidate.name} (${LEVEL[level]})`); }
            if (others && (others.for > 0 || others.against > 0)) parts.push(`of the ${others.total} other associations of ${confederation.fifa}, ${others.for} are shown for him and ${others.against} against him`);
            if (parts.length > 0) add({kind: 'confederation', text: `${parts.join('; ')}.`});
        }
    }
    return facts;
};

// what the model is given: the facts and the rules
export const promptOfSummary = ({member, facts}) => `You help a reader understand where one national football association stands in the election of the president of FIFA, ONLY from the numbered facts below.

Rules:
- Write 2 to 5 short claims in English, each one sentence. A claim says only what the facts say: no background knowledge, no guess about what will happen, no opinion, nothing about a person that is not in a fact.
- Every claim cites the numbers of the facts it rests on. A position that is "probable" is said with "probably" or "appears to"; one that is "declared" is said plainly. Say who said something only when a fact says it.
- Do not write a figure or a date that is not in the facts you cite.
Answer with the JSON object only, no other text: {"claims": [{"text": "...", "facts": [1, 2]}]}

Association: ${member.name}

Facts:
${facts.map(fact => `${fact.id}. ${fact.text}`).join('\n')}`;

// The claims of a model's answer that hold: [{text, facts: [ids]}], at most five. A claim is kept when it has a text of 10 to 400 characters, cites at least one fact that exists, and holds no
// figure (a run of digits) that is not in the facts it cites; the others are dropped
export const claimsOf = (answer, facts) => {
    const list = Array.isArray(answer?.claims) ? answer.claims : [];
    const byId = new Map(facts.map(fact => [fact.id, fact]));
    const kept = [];
    for (const claim of list) {
        const text = typeof claim?.text === 'string' ? claim.text.replace(/\s+/g, ' ').trim() : '';
        const cited = [...new Set((Array.isArray(claim?.facts) ? claim.facts : []).map(Number).filter(id => byId.has(id)))];
        if (text.length < 10 || text.length > 400 || cited.length === 0) continue;
        const source = cited.map(id => byId.get(id).text).join(' ');
        if ((text.match(/\d+/g) ?? []).some(figure => !source.includes(figure))) continue;
        kept.push({text, facts: cited});
        if (kept.length === MAX_CLAIMS) break;
    }
    return kept;
};

// a fingerprint of what the claims were written from: the sheet changing makes the summary "older"
export const inputHashOf = (facts) => createHash('sha1').update(JSON.stringify(facts.map(fact => [fact.kind, fact.text]))).digest('hex').slice(0, 16);
