//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: positions-service.js
//  Description: What /api/v1 answers: the persons followed, the position of each association on one of them, the
//               signals behind it and what changed. Reads the fixed answers of positions-mock.js until the real
//               table exists: the controller and the routes do not change when it does, only this file
//

"use strict"

import {ASSOCIATIONS, NOW, POSITIONS, SUBJECTS} from './utils/positions-mock.js';

const DAY = 864e5;
// the age after which the last official word of an association is shown as old (the doc, "stale")
const STALE_DAYS = 90;

const fail = (status, code, message) => Object.assign(new Error(message), {status, code});

// 'for' for the two positions of support, 'against' for the two of opposition, null for none
const sideOf = (position) => position.startsWith('non_soutien') ? 'against' : position.startsWith('soutien') ? 'for' : null;

const subjectOf = (qid) => SUBJECTS.find(subject => subject.qid === qid)
    ?? (() => { throw fail(404, 'unknown_subject', `${qid} is not a person followed: GET /api/v1/subjects lists them.`); })();

const recordOf = (subject, association) => POSITIONS[subject.qid]?.[association.fifa] ?? null;

// the persons whose position is known for at least one association (not a confederation: it votes no)
const known = (subject) => ASSOCIATIONS.filter(association => association.level === 'association' && recordOf(subject, association)).length;

const describe = (subject) => ({...subject, positions_known: known(subject)});
const summary = (subject) => ({qid: subject.qid, name: subject.name});

// the position of an association on one subject (record: null when it has said nothing), without the signals
const fieldsOf = (record) => {
    const side = record ? sideOf(record.position) : null;
    const before = record?.previous ? sideOf(record.previous.position) : null;
    const newest = record?.signals[0];
    return {
        position: record?.position ?? 'inconnue',
        since: record?.since ?? null,
        previous: record?.previous ?? null,
        changed: before !== null && side !== null && before !== side,
        confidence: record?.confidence ?? null,
        stale: record ? Date.parse(NOW) - Date.parse(record.since) > STALE_DAYS * DAY : false,
        signals_count: record ? (record.total ?? record.signals.length) : 0,
        last_signal_at: newest?.published_at ?? null,
    };
};

// one association on one subject: what the map and the list need
const rowOf = (association, record) => ({association: {...association}, ...fieldsOf(record)});

// what the fiche of an association keeps of its position: the signals are given in full next to it
const positionOf = (record) => {
    const {position, since, previous, changed, confidence, stale} = fieldsOf(record);
    return {position, since, previous, changed, confidence, stale};
};

// a signal of the fiche: the translation is the one of the language asked, only when it is not the language of the sentence
const signalOf = (signal, subject, lang) => {
    const translation = signal.lang === lang ? null : signal.translations[lang] ?? null;
    return {
        id: signal.id,
        date: signal.date,
        stance: signal.stance,
        target: {...summary(subject), kind: subject.status === 'incumbent' ? 'incumbent' : 'candidate'},
        mark: signal.mark,
        speaker: signal.speaker,
        sentence: signal.sentence,
        lang: signal.lang,
        translation,
        translation_by: translation === null ? null : 'ai',
        url: signal.url,
        medium: signal.medium,
        published_at: signal.published_at,
        news_count: signal.news,
        media_count: signal.media,
        read_by: 'ai',
        checked: true,
    };
};

// what a position became: a first one, the other side, or the same side said less firmly
const kindOf = (record) => {
    if (!record.previous) return 'first';
    const before = sideOf(record.previous.position), now = sideOf(record.position);
    if (before !== now) return 'reversal';
    return record.previous.position.endsWith('declare') && record.position.endsWith('probable') ? 'weakened' : null;
};

export const PositionsService = {
    // the answers are fixed ones, the headers and the body say so
    source: 'mock',

    subjects: ({status = null} = {}) => ({
        mock: true,
        subjects: SUBJECTS.filter(subject => status === null || subject.status === status).map(describe),
    }),

    // the confederations only when asked: they are no voters, and have far more signals than an association
    positions: ({subject, confederations = false}) => {
        const person = subjectOf(subject);
        return {
            mock: true,
            subject: describe(person),
            updated_at: NOW,
            positions: ASSOCIATIONS.filter(association => confederations || association.level === 'association')
                .map(association => rowOf(association, recordOf(person, association))),
        };
    },

    // id: the code of the FIFA or the QID. With a subject, its position and its signals (newest first, from `since`,
    // `limit` at most); without, its position on every person followed, no signal
    association: ({id, subject = null, since = null, limit = 50, lang = 'fr'}) => {
        const wanted = String(id).toUpperCase();
        const association = ASSOCIATIONS.find(one => one.fifa === wanted || one.qid === wanted);
        if (!association) throw fail(404, 'unknown_association', `${id} is no association: its FIFA code or its QID.`);
        if (subject === null) {
            return {
                mock: true,
                association: {...association},
                subjects: SUBJECTS.map(person => ({
                    subject: {...summary(person), status: person.status},
                    ...fieldsOf(recordOf(person, association)),
                })),
            };
        }
        const person = subjectOf(subject);
        const record = recordOf(person, association);
        return {
            mock: true,
            association: {...association},
            subject: summary(person),
            ...positionOf(record),
            signals: (record?.signals ?? [])
                .filter(signal => since === null || signal.date >= since)
                .slice(0, limit)
                .map(signal => signalOf(signal, person, lang)),
        };
    },

    // the positions that appeared or moved since a day, the newest first; the confederations are left out
    changes: ({subject, since, kind = null}) => {
        const person = subjectOf(subject);
        const changes = [];
        for (const association of ASSOCIATIONS.filter(one => one.level === 'association')) {
            const record = recordOf(person, association);
            if (!record || record.since < since) continue;
            const what = kindOf(record);
            if (what === null || (kind !== null && what !== kind)) continue;
            changes.push({
                association: {qid: association.qid, fifa: association.fifa, name: association.name},
                kind: what,
                from: record.previous?.position ?? 'inconnue',
                to: record.position,
                at: record.since,
                signal_id: record.signals[0].id,
            });
        }
        changes.sort((a, b) => b.at.localeCompare(a.at) || a.association.fifa.localeCompare(b.association.fifa));
        return {mock: true, subject: summary(person), changes};
    },
};
