//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-audit.js
//  Description: The weekly audit of the positions the map of the FIFA presidency shows (pure: the numbers and the verdict). Two things are
//               counted: 1. a random sample of the established signals (the ones that colour) read again by a THIRD model, of a family
//               that read neither time: the share it agrees with is a live measure of the precision, to be read with its interval
//               (it is an agreement, not the truth: the gold set of bench/fifa is the truth); 2. the votes of the readers against what
//               the news said: a reader who sets a position the other way is a human disagreement with the system
//

"use strict"

// the 95% interval of Wilson of k out of n
import process from 'node:process';

export const wilson = (k, n) => {
    if (n === 0) return [0, 1];
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const centre = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
};

// the side a position stands on, null for none
export const sideOf = (position) => !position || position === 'inconnue' ? null : String(position).startsWith('non_') ? 'against' : 'for';

// up to n of the rows, at random, the recent ones first when the rows say which are (row.recent)
export const sampleOf = (rows, n, random = Math.random) => {
    const shuffle = (list) => list.map(row => [random(), row]).sort((a, b) => a[0] - b[0]).map(pair => pair[1]);
    return [...shuffle(rows.filter(row => row.recent)), ...shuffle(rows.filter(row => !row.recent))].slice(0, n);
};

// whether the auditor reads an established signal the same: established, on the same side
export const agrees = (reading, signal) => reading?.status === 'established' && reading.stance === signal.stance;

// the votes against the news, from the map as the page reads it: {voted, confirms, contradicts, adds, contradicting: [...]}
// "confirms": the reader sets the side the news gave; "contradicts": the other side, or no position where the news gave one;
// "adds": a position where the news had none
export const votesAgainstNews = (map) => {
    const found = {voted: 0, confirms: 0, contradicts: 0, adds: 0, contradicting: [], validated: 0};
    for (const member of map.members) {
        for (const [subject, position] of Object.entries(member.positions)) {
            // a position a reader validated by hand (confirmed): a human agreement with the news, the best live sign of precision there is
            if (!position.human && position.confirmed?.count > 0 && sideOf(position.ai_position)) found.validated++;
            if (!position.human) continue;
            found.voted++;
            const ai = sideOf(position.ai_position);
            const human = position.human.value === 'for' ? 'for' : position.human.value === 'against' ? 'against' : null;
            if (!ai) found.adds++;
            else if (human === ai) found.confirms++;
            else {
                found.contradicts++;
                found.contradicting.push({subject_qid: subject, member_qid: member.qid, fifa: member.fifa, ai: position.ai_position, human: position.human.value, by: position.human.by});
            }
        }
    }
    return found;
};

export const MIN_SAMPLE = 10;
export const minAgreement = (value = process.env.FIFA_AUDIT_MIN_AGREEMENT) => {
    const number = Number(value);
    return number > 0 && number <= 1 ? number : 0.85;
};

// "ok", "warning" (the agreement is under the threshold: look at the disagreements, think of FIFA_COLOUR=declared or off), "too_few" (a sample too small to say)
export const verdictOf = ({sampled, agreed, threshold = minAgreement()}) => sampled < MIN_SAMPLE ? 'too_few' : agreed / sampled >= threshold ? 'ok' : 'warning';

export const reportOf = ({sampled, agreed, unreadable, auditor, votes, verdict, threshold = minAgreement(), disagreements = []}) => {
    const [lo, hi] = wilson(agreed, sampled);
    const pct = (x) => `${(100 * x).toFixed(0)}%`;
    const lines = [
        `FIFA map audit: ${verdict.toUpperCase()}`,
        `  ${sampled} established signals read again by ${auditor}: ${agreed} agree${sampled ? ` = ${pct(agreed / sampled)} (95% interval ${pct(lo)} to ${pct(hi)}, threshold ${pct(threshold)})` : ''}${unreadable ? `, ${unreadable} unreadable` : ''}`,
        `  votes of the readers: ${votes.voted} (${votes.confirms} confirm the news, ${votes.contradicts} contradict them, ${votes.adds} add a position where there was none); ${votes.validated} positions of the news validated by a confirmation`,
    ];
    for (const item of disagreements.slice(0, 10)) lines.push(`  - the auditor says ${item.auditor}${item.reason ? `/${item.reason}` : ''}, the signal says ${item.stance}: [${item.member}] ${item.sentence}`);
    for (const item of votes.contradicting.slice(0, 10)) lines.push(`  - ${item.by} sets "${item.human}" on ${item.fifa}, the news said ${item.ai}`);
    return lines.join('\n');
};
