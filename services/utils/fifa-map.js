//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-map.js
//  Description: What the page "The FIFA presidency" reads, built from the rows of the database (pure: rows in, the shapes of bench/fifa/README.md of
//               the client out). The position of an association on a candidate comes from its established signals (fifa-positions.js); a vote of a
//               reader decides over it for everyone (the latest vote of each reader who has not taken it back, the newest of those
//               wins); FIFA_COLOUR says what colours (established = declared and probable, declared = only the declared, off = nothing)
//

"use strict"

import process from 'node:process';
import {historyOf, positionOf} from './fifa-positions.js';
import {ROLE} from './fifa-labels.js';

export const COLOURS = ['established', 'declared', 'off'];
export const colourSetting = (value = process.env.FIFA_COLOUR) => COLOURS.includes(value) ? value : 'established';

// the values of `position` the server stands behind (what the page derives its legend and its filters from)
export const levelsOf = (colour) => colour === 'off' ? ['inconnue']
    : colour === 'declared' ? ['soutien_declare', 'inconnue', 'non_soutien_declare']
        : ['soutien_declare', 'soutien_probable', 'inconnue', 'non_soutien_probable', 'non_soutien_declare'];

// the names the page has for the reasons a reading is only uncertain
const REASON = {not_binding: 'speaker_not_binding', reported: 'rumour', request: 'request_not_position', rival: 'rival_from_association', ambiguous: 'ambiguous',
    readings_disagree: 'readings_disagree', unconfirmed: 'unconfirmed', denied: 'denied', past: 'past', other: 'other'};
export const reasonFor = (reason) => REASON[reason] ?? reason ?? '';

const VOTED = {for: 'soutien_declare', against: 'non_soutien_declare', unknown: 'inconnue'};

// The vote that decides: of each reader the latest vote counts, a reader who took it back counts for nothing, and the newest of the rest decides.
// votes: [{user_id, username, value, note, created_at}] -> {value, by, at, note} | null
export const decisiveVote = (votes) => {
    const last = new Map();
    for (const vote of votes) {
        const found = last.get(vote.user_id);
        if (!found || new Date(vote.created_at) > new Date(found.created_at)) last.set(vote.user_id, vote);
    }
    const standing = [...last.values()].filter(vote => vote.value !== 'withdraw').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return standing.length === 0 ? null : {value: standing[0].value, by: standing[0].username, at: new Date(standing[0].created_at).toISOString(), note: standing[0].note ?? ''};
};

// the signals as the colour setting reads them: what the setting does not colour counts as uncertain
const withColour = (signals, colour) => signals.map(signal => {
    if (signal.certainty !== 'established') return signal;
    if (colour === 'off' || (colour === 'declared' && signal.level !== 'declared')) return {...signal, certainty: 'uncertain'};
    return signal;
});
const dated = (signal) => ({...signal, date: signal.published_at});

// The position of one association on one candidate: {position, since, previous, changed, stale, signals_count, last_signal_at, uncertain_count, articles_30d,
// media_30d, basis, human?, ai_position?}, or null when there is nothing to say
export const positionFor = ({signals, votes, colour, now}) => {
    const read = positionOf(withColour(signals, colour).map(dated), now);
    const articles = signals.reduce((sum, signal) => sum + (signal.news_count ?? 0), 0);
    const media = new Set(signals.map(signal => signal.medium)).size;
    const basis = signals.filter(signal => signal.certainty === 'established' && read.position !== 'inconnue')
        .sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 2).map(signal => ({medium: signal.medium, published_at: new Date(signal.published_at).toISOString(), url: signal.url}));
    const human = decisiveVote(votes);
    if (read.position === 'inconnue' && read.uncertain === 0 && articles === 0 && !human) return null;
    const answer = {
        position: read.position, since: read.since, previous: read.previous, changed: read.changed, stale: read.stale, signals_count: read.signals, last_signal_at: read.lastSignalAt,
        uncertain_count: read.uncertain, articles_30d: articles, media_30d: media, basis,
    };
    if (!human) return {...answer, human: null};
    // news that say the other thing after the vote: the page invites to vote again, the colour does not move
    const after = signals.filter(signal => signal.certainty === 'established' && new Date(signal.published_at) > new Date(human.at));
    const newer = after.some(signal => human.value === 'unknown' || (human.value === 'for') !== (signal.stance === 'for'));
    return {...answer, position: VOTED[human.value], ai_position: answer.position, stale: false, human: {value: human.value, by: human.by, at: human.at, newer_evidence: newer}};
};

const group = (rows, key) => {
    const groups = new Map();
    for (const row of rows) {
        const k = key(row);
        groups.set(k, [...(groups.get(k) ?? []), row]);
    }
    return groups;
};
const voted = (position) => position !== null && position.position !== 'inconnue';

// {generated_at, levels, subjects, members} (bench/fifa/README.md of the client)
export const buildMap = ({members, subjects, signals, votes, leaders = new Map(), colour = colourSetting(), now = new Date()}) => {
    const bySubjectMember = group(signals, signal => `${signal.subject_qid}|${signal.member_qid}`);
    const votesOf = group(votes, vote => `${vote.subject_qid}|${vote.member_qid}`);
    const known = new Map(), uncertain = new Map();
    const rows = members.map(member => {
        const positions = {};
        for (const subject of subjects) {
            const key = `${subject.qid}|${member.qid}`;
            const position = positionFor({signals: bySubjectMember.get(key) ?? [], votes: votesOf.get(key) ?? [], colour, now});
            if (!position) continue;
            positions[subject.qid] = position;
            if (voted(position)) known.set(subject.qid, (known.get(subject.qid) ?? 0) + 1);
            else if (position.uncertain_count > 0) uncertain.set(subject.qid, (uncertain.get(subject.qid) ?? 0) + 1);
        }
        const mine = signals.filter(signal => signal.member_qid === member.qid);
        return {
            qid: member.qid, fifa: member.fifa, name: member.name, association: member.association, level: member.level, confederation: member.confederation, iso: member.iso,
            lat: member.lat, lng: member.lng, leader: leaders.get(member.qid) ?? null,
            coverage: {articles_30d: mine.reduce((sum, signal) => sum + (signal.news_count ?? 0), 0), media_30d: new Set(mine.map(signal => signal.medium)).size},
            positions,
        };
    });
    return {
        generated_at: now.toISOString(), levels: levelsOf(colour),
        subjects: subjects.map(subject => ({qid: subject.qid, name: subject.name, color_index: subject.color_index, status: subject.status, state: subject.state,
            positions_known: known.get(subject.qid) ?? 0, uncertain_count: uncertain.get(subject.qid) ?? 0})),
        members: rows,
    };
};

// the sheet of one association: {member, positions, leader, votes, signals, history}
export const buildSheet = ({member, subjects, signals, votes, leader = null, colour = colourSetting(), now = new Date()}) => {
    const positions = {};
    for (const subject of subjects) {
        const position = positionFor({signals: signals.filter(signal => signal.subject_qid === subject.qid), votes: votes.filter(vote => vote.subject_qid === subject.qid), colour, now});
        if (position) positions[subject.qid] = position;
    }
    const history = subjects.flatMap(subject => historyOf(withColour(signals.filter(signal => signal.subject_qid === subject.qid), colour).map(dated)).map(change => ({subject_qid: subject.qid, ...change})));
    return {
        member: {qid: member.qid, fifa: member.fifa, name: member.name, association: member.association, level: member.level, confederation: member.confederation, iso: member.iso, lat: member.lat, lng: member.lng},
        positions, leader,
        votes: [...votes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(vote => ({subject_qid: vote.subject_qid, value: vote.value, by: vote.username, at: new Date(vote.created_at).toISOString(), note: vote.note ?? ''})),
        signals: signals.filter(signal => signal.certainty !== 'discarded').sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).map(signal => ({
            id: signal.id, subject_qid: signal.subject_qid,
            certainty: signal.certainty === 'established' && withColour([signal], colour)[0].certainty === 'established' ? 'established' : 'uncertain',
            uncertain_reason: signal.certainty === 'uncertain' ? reasonFor(signal.uncertain_reason) : signal.certainty === 'established' && withColour([signal], colour)[0].certainty === 'uncertain' ? 'colour_setting' : '',
            stance: signal.stance, level: signal.level, mark: signal.mark,
            speaker: {name: signal.speaker ?? '', role: ROLE[signal.speaker_kind] ?? '', binds: ['president', 'executive', 'statement'].includes(signal.speaker_kind)},
            sentence: signal.sentence, translation: null, url: signal.url, medium: signal.medium, published_at: new Date(signal.published_at).toISOString(), lang: signal.lang,
        })),
        history,
    };
};
