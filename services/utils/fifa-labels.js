//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-labels.js
//  Description: The closed words of the reading of a passage (the guide is fifa-guide.md) and the rules the CODE applies to them: whether
//               a reading is well formed, and the status it calls for. The AI says who speaks, for whom, how plainly; the code decides
//               whether it is a position (established: a colour), only uncertain (a badge, no colour) or discarded (nothing). The
//               benches of bench/fifa and the service that reads the news share these rules, so what was measured is what runs
//

"use strict"

export const VOCAB = {
    association_ok: ['yes', 'no'],
    speaker_kind: ['president', 'executive', 'statement', 'deputy', 'former', 'candidate', 'government', 'other', 'none'],
    stance: ['for', 'against', 'undecided', 'none'],
    toward: ['person', 'other', 'nobody'],
    mark: ['official', 'reported', 'denied'],
    level: ['declared', 'probable', 'none'],
    status: ['established', 'uncertain', 'discarded'],
    reason: ['', 'not_binding', 'rival', 'request', 'reported', 'denied', 'past', 'praise', 'ambiguous', 'other'],
    confidence: ['high', 'low'],
};
// only these speak as the association
export const BINDING = new Set(['president', 'executive', 'statement']);
// the role the page writes for a kind of speaker
export const ROLE = {president: 'President', executive: 'Executive', statement: 'Association statement', deputy: 'Vice-president', former: 'Former or honorary official',
    candidate: 'Candidate', government: 'Government', other: 'Other', none: ''};

// a doubt the fields cannot show: the reader's own, it keeps a reading uncertain whatever the fields say
export const HELD_BACK = ['request', 'past', 'praise', 'ambiguous', 'other'];

// What makes a reading unusable (the words are none of the guide's, a stance with no level): [] when the code can decide its status. The status
// and the reason a model gives are not checked here, the code decides them (statusOf): a model that calls a deputy "established" is read as uncertain
export const formProblems = (label) => {
    const problems = [];
    if (typeof label?.id !== 'string') return ['no id'];
    if (typeof label.about_election !== 'boolean') problems.push('about_election is not true/false');
    for (const [field, words] of Object.entries(VOCAB)) {
        if (['status', 'reason', 'confidence'].includes(field)) continue;
        if (!words.includes(label[field])) problems.push(`${field}: "${label[field]}" is none of ${words.join('/')}`);
    }
    if (problems.length === 0 && ['for', 'against'].includes(label.stance) && label.level === 'none') problems.push('a stance for/against needs a level');
    return problems;
};

// the problems of one label, [] when it is a reading the guide allows
export const problemsOf = (label) => {
    const problems = [];
    if (typeof label?.id !== 'string') return ['no id'];
    if (typeof label.about_election !== 'boolean') problems.push('about_election is not true/false');
    for (const [field, words] of Object.entries(VOCAB)) if (!words.includes(label[field])) problems.push(`${field}: "${label[field]}" is none of ${words.join('/')}`);
    if (problems.length > 0) return problems;
    const {status} = label;
    const discarded = label.association_ok === 'no' || label.about_election === false;
    const established = !discarded && label.toward === 'person' && ['for', 'against'].includes(label.stance) && BINDING.has(label.speaker_kind) && label.mark === 'official';
    if (discarded && status !== 'discarded') problems.push('association_ok "no" or about_election false must be discarded');
    if (!discarded && status === 'discarded') problems.push('discarded needs association_ok "no" or about_election false');
    // a request, a past position, a wording that is no clear position or any other doubt of the reader can make "uncertain" what the fields alone would call established
    if (established && status !== 'established' && !HELD_BACK.includes(label.reason)) problems.push('every condition of established is met but the status is not (only the reasons request, past, ambiguous or other can hold it back)');
    if (!established && status === 'established') problems.push('established needs: toward person, stance for/against, a bound speaker, mark official');
    if (status === 'uncertain' && label.reason === '') problems.push('uncertain needs a reason');
    if (status !== 'uncertain' && label.reason !== '') problems.push('only uncertain has a reason');
    if (['for', 'against'].includes(label.stance) && label.level === 'none') problems.push('a stance for/against needs a level');
    if (!['for', 'against'].includes(label.stance) && label.level !== 'none') problems.push('no stance, so the level is none');
    return problems;
};

// The status the fields call for, and the reason when it is uncertain: what the code decides from the closed words of a reading
export const statusOf = (label) => {
    if (label.association_ok === 'no' || label.about_election === false) return {status: 'discarded', reason: ''};
    const bound = BINDING.has(label.speaker_kind);
    const established = label.toward === 'person' && ['for', 'against'].includes(label.stance) && bound && label.mark === 'official';
    if (established && !HELD_BACK.includes(label.reason)) return {status: 'established', reason: ''};
    if (established) return {status: 'uncertain', reason: label.reason};
    const reason = label.mark === 'denied' ? 'denied'
        : label.speaker_kind === 'candidate' || label.toward === 'other' ? 'rival'
            : label.mark === 'reported' ? 'reported'
                : ['deputy', 'former', 'government', 'other'].includes(label.speaker_kind) && ['for', 'against'].includes(label.stance) ? 'not_binding'
                    : HELD_BACK.includes(label.reason) ? label.reason : 'ambiguous';
    return {status: 'uncertain', reason};
};
