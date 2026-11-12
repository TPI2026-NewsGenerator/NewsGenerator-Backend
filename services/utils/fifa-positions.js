//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-positions.js
//  Description: The position the map shows for an association on a person, from its signals: only an ESTABLISHED signal (a bound speaker,
//               official, a stance toward the person) can colour or change a colour; an uncertain one never does, it is counted and
//               shown with its badge. The latest established signal holds the position; a flip to the other side takes effect on a
//               DECLARED signal, or when two established signals say it (one probable signal against a declared position makes the
//               indications "conflicting", it does not turn the colour); a position older than 90 days is stale. The thresholds are
//               checked against the chronologies of the gold set (bench/fifa)
//

"use strict"

export const STALE_DAYS = 90;
export const CONFLICT_DAYS = 30;
export const FLIP_SIGNALS = 2;

const DAY = 864e5;
const name = (stance, level) => `${stance === 'for' ? 'soutien' : 'non_soutien'}_${level === 'declared' ? 'declare' : 'probable'}`;
const day = (date) => new Date(date).getTime();

// signals: [{date, certainty: 'established'|'uncertain', stance: 'for'|'against', level: 'declared'|'probable'}]; now: a date.
// -> {position, since, previous, changed, conflicting, stale, signals, uncertain, lastSignalAt}
export const positionOf = (signals, now = new Date()) => {
    const uncertain = signals.filter(signal => signal.certainty === 'uncertain').length;
    const established = signals.filter(signal => signal.certainty === 'established' && ['for', 'against'].includes(signal.stance))
        .sort((a, b) => day(a.date) - day(b.date));
    const none = {position: 'inconnue', since: null, previous: null, changed: false, conflicting: false, stale: false, signals: 0, uncertain, lastSignalAt: null};
    if (established.length === 0) return none;

    // walk the signals in order: the position moves to the other side only on a declared signal, or on the second signal of that side
    let current = null, previous = null, since = null, pending = [];
    for (const signal of established) {
        if (current === null) {
            current = {stance: signal.stance, level: signal.level};
            since = signal.date;
            continue;
        }
        if (signal.stance === current.stance) {
            // the same side again: a declared signal firms a probable position up, the older one never weakens a declared one
            if (signal.level === 'declared' && current.level !== 'declared') current = {stance: current.stance, level: 'declared'};
            pending = [];
            continue;
        }
        pending.push(signal);
        if (signal.level === 'declared' || pending.length >= FLIP_SIGNALS) {
            previous = name(current.stance, current.level);
            current = {stance: signal.stance, level: pending.some(p => p.level === 'declared') ? 'declared' : 'probable'};
            since = pending[0].date;
            pending = [];
        }
    }
    const last = established[established.length - 1];
    const conflicting = pending.length > 0 && day(now) - day(pending[pending.length - 1].date) <= CONFLICT_DAYS * DAY;
    return {
        position: name(current.stance, current.level), since, previous, changed: previous !== null, conflicting,
        stale: day(now) - day(last.date) > STALE_DAYS * DAY, signals: established.length, uncertain, lastSignalAt: last.date,
    };
};

// The changes of position of an association on a person, in order: [{date, from, to, kind, url, medium}], kind "first" (a position after none), "reversal" (the other
// side) or "weakened" (the same side, declared to probable); url and medium: the article of the signal that made the change (null when the signal has none), so the page can
// send the reader to it. Replayed signal by signal with the same rules as positionOf, so the page shows what the map showed
export const historyOf = (signals) => {
    const established = signals.filter(signal => signal.certainty === 'established' && ['for', 'against'].includes(signal.stance)).sort((a, b) => day(a.date) - day(b.date));
    const changes = [];
    let before = 'inconnue';
    for (let i = 0; i < established.length; i++) {
        const now = positionOf(established.slice(0, i + 1), new Date(established[i].date)).position;
        if (now === before) continue;
        const side = (position) => position.startsWith('non_') ? 'against' : position === 'inconnue' ? 'none' : 'for';
        changes.push({date: established[i].date, from: before, to: now, kind: before === 'inconnue' ? 'first' : side(before) !== side(now) ? 'reversal' : 'weakened',
            url: established[i].url ?? null, medium: established[i].medium ?? null});
        before = now;
    }
    return changes;
};
