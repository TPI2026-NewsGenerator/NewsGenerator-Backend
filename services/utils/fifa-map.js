//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-map.js
//  Description: What the page "The FIFA presidency" reads, built from the rows of the database (pure: rows in, the shapes of bench/fifa/README.md of
//               the client out). The position of an association on a candidate comes from its established signals (fifa-positions.js); a vote of a
//               reader decides over it for everyone (the latest vote of each reader who has not taken it back, the newest of those
//               wins); a reader who CONFIRMS the position the news gave validates it by hand, the heaviest word there is: it is drawn solid, at the declared
//               level, whatever it was (until the news change it: the confirmation is then outdated and the reading of the news shows again); FIFA_COLOUR
//               says what colours (established = declared and probable, declared = only the declared, off = nothing)
//

"use strict"

import process from 'node:process';
import {sideOf} from './fifa-audit.js';
import {historyOf, positionOf} from './fifa-positions.js';
import {BINDING, ROLE} from './fifa-labels.js';

export const COLOURS = ['established', 'declared', 'off'];
export const colourSetting = (value = process.env.FIFA_COLOUR) => COLOURS.includes(value) ? value : 'established';

// the values of `position` the server stands behind (what the page derives its legend and its filters from)
export const levelsOf = (colour) => colour === 'off' ? ['inconnue']
    : colour === 'declared' ? ['soutien_declare', 'inconnue', 'non_soutien_declare']
        : ['soutien_declare', 'soutien_probable', 'inconnue', 'non_soutien_probable', 'non_soutien_declare'];

// the names the page has for the reasons a reading is only uncertain
const REASON = {not_binding: 'speaker_not_binding', reported: 'rumour', request: 'request_not_position', rival: 'rival_from_association', ambiguous: 'ambiguous',
    readings_disagree: 'readings_disagree', unconfirmed: 'unconfirmed', denied: 'denied', past: 'past', praise: 'praise_only', other: 'other'};
export const reasonFor = (reason) => REASON[reason] ?? reason ?? '';

const VOTED = {for: 'soutien_declare', against: 'non_soutien_declare', unknown: 'inconnue'};

// What the votes of each reader leave standing: their latest decision (for, against, unknown) and their latest confirmation. Taking the vote back
// ("withdraw") takes both away. A confirmation is no decision: a reader who sets a position and then confirms keeps their decision
const standing = (votes) => {
    const byReader = new Map();
    for (const vote of [...votes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
        const state = byReader.get(vote.user_id) ?? {decision: null, confirm: null};
        if (vote.value === 'withdraw') { state.decision = null; state.confirm = null; }
        else if (vote.value === 'confirm') state.confirm = vote;
        else state.decision = vote;
        byReader.set(vote.user_id, state);
    }
    return [...byReader.values()];
};
const newest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

// The source a reader joined to a vote (the link of the page that says it) and what the AI read in it: {url, medium, check, found, checked_at} or null. check:
// "pending" (not read yet), "says" (the page says what the reader chose; found = the sentence), "contradicts" (it says the other thing), "unclear", "unreadable"
export const sourceOf = (vote) => vote?.source_url
    ? {url: vote.source_url, medium: vote.source_medium ?? '', check: vote.source_check || 'pending', found: vote.source_found ?? '', checked_at: vote.source_checked_at ? new Date(vote.source_checked_at).toISOString() : null}
    : null;

// The vote that decides: of each reader the latest decision counts, a reader who took it back counts for nothing, and the newest of the rest decides.
// votes: [{user_id, username, value, note, created_at, source_*}] -> {value, by, at, note, source} | null
export const decisiveVote = (votes) => {
    const decisions = standing(votes).map(state => state.decision).filter(Boolean).sort(newest);
    return decisions.length === 0 ? null : {value: decisions[0].value, by: decisions[0].username, at: new Date(decisions[0].created_at).toISOString(), note: decisions[0].note ?? '', source: sourceOf(decisions[0])};
};

// The readers who confirmed the position ("Confirm this position"): {count, by, at, outdated} or null when nobody did. A confirmation counts for the
// position the reader saw (vote.seen, the position of the news, or the one a reader set): when it changed since, it is "outdated" (the news said more
// after it) and validates nothing any more
export const confirmationsOf = (votes, shown) => {
    const confirms = standing(votes).map(state => state.confirm).filter(Boolean).sort(newest);
    if (confirms.length === 0) return null;
    const current = confirms.filter(vote => vote.seen === shown);
    return {count: current.length, by: current.map(vote => vote.username), at: current[0] ? new Date(current[0].created_at).toISOString() : null, outdated: confirms.length - current.length};
};

// the signals as the colour setting reads them: what the setting does not colour counts as uncertain
const withColour = (signals, colour) => signals.map(signal => {
    if (signal.certainty !== 'established') return signal;
    if (colour === 'off' || (colour === 'declared' && signal.level !== 'declared')) return {...signal, certainty: 'uncertain'};
    return signal;
});
const dated = (signal) => ({...signal, date: signal.published_at});

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

// The articles and the media of the LAST 30 DAYS that name an association with a candidate: the figure of the list, of the tooltip and of the sheet. A signal stands for
// news_count articles and is dated by the news it shows; the older ones are not counted (they still colour: a position stays 90 days). The same article names two
// candidates in two signals with the same link: it is counted once (the larger count), never twice
export const recentCoverage = (signals, now = new Date()) => {
    const from = now.getTime() - THIRTY_DAYS_MS;
    const byLink = new Map();
    for (const signal of signals) {
        if (new Date(signal.published_at).getTime() < from) continue;
        const key = signal.url ?? `signal:${signal.id}`;
        const articles = signal.news_count ?? 0;
        if (articles > (byLink.get(key)?.articles ?? -1)) byLink.set(key, {articles, medium: signal.medium});
    }
    return {articles_30d: [...byLink.values()].reduce((sum, one) => sum + one.articles, 0), media_30d: new Set([...byLink.values()].map(one => one.medium)).size};
};

// The position of one association on one candidate: {position, since, previous, changed, stale, signals_count, last_signal_at, uncertain_count, articles_30d,
// media_30d, basis, human?, ai_position?}, or null when there is nothing to say
// The position a confirmation would be a confirmation of (what the page shows the reader before they confirm): the one a reader set, else the one of the news
export const basePosition = ({signals, votes, colour, now}) => {
    const human = decisiveVote(votes);
    return human ? VOTED[human.value] : positionOf(withColour(signals, colour).map(dated), now).position;
};

export const positionFor = ({signals, votes, colour, now}) => {
    const read = positionOf(withColour(signals, colour).map(dated), now);
    // anything read at all (even a passage left out) keeps the association on the map; the figures shown are the ones of the last 30 days
    const read_ever = signals.reduce((sum, signal) => sum + (signal.news_count ?? 0), 0);
    const coverage = recentCoverage(signals, now);
    const basis = signals.filter(signal => signal.certainty === 'established' && read.position !== 'inconnue')
        .sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 2).map(signal => ({medium: signal.medium, published_at: new Date(signal.published_at).toISOString(), url: signal.url}));
    const human = decisiveVote(votes);
    // what a confirmation is a confirmation OF: the position a reader set, else the one of the news (not the one it is drawn at after a confirmation)
    const base = human ? VOTED[human.value] : read.position;
    const confirmed = confirmationsOf(votes, base);
    if (read.position === 'inconnue' && read.uncertain === 0 && read_ever === 0 && !human && !confirmed) return null;
    const answer = {
        position: read.position, since: read.since, previous: read.previous, changed: read.changed, stale: read.stale, signals_count: read.signals, last_signal_at: read.lastSignalAt,
        uncertain_count: read.uncertain, ...coverage, basis,
    };
    if (!human) {
        // validated by hand: solid, at the declared level, never old; the reading of the news stays visible as ai_position
        if (confirmed?.count > 0 && read.position !== 'inconnue') {
            return {...answer, position: read.position.startsWith('non_') ? 'non_soutien_declare' : 'soutien_declare', ai_position: read.position, stale: false, human: null, confirmed};
        }
        return {...answer, human: null, confirmed};
    }
    // news that say the other thing after the vote: the page invites to vote again, the colour does not move
    const after = signals.filter(signal => signal.certainty === 'established' && new Date(signal.published_at) > new Date(human.at));
    const newer = after.some(signal => human.value === 'unknown' || (human.value === 'for') !== (signal.stance === 'for'));
    return {...answer, position: VOTED[human.value], ai_position: answer.position, stale: false, human: {value: human.value, by: human.by, at: human.at, newer_evidence: newer, source: human.source}, confirmed};
};

// The candidate an association leans toward, from its positions on the candidates: {subject_qid, source, conflicting} or null when it supports none.
// source "reader" when a reader chose it or confirmed it, "news" when only the news say it; two candidates supported at once is "conflicting"
// (subject_qid null, the list of them): the association has one vote, a reader settles it by choosing
export const leanOf = (positions) => {
    const supports = Object.entries(positions).filter(([, position]) => sideOf(position.position) === 'for')
        .map(([qid, position]) => ({qid, reader: Boolean(position.human) || position.confirmed?.count > 0}));
    if (supports.length === 0) return null;
    if (supports.length === 1) return {subject_qid: supports[0].qid, source: supports[0].reader ? 'reader' : 'news', conflicting: []};
    return {subject_qid: null, source: 'news', conflicting: supports.map(one => one.qid)};
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

// The sources the readers' choices stand on, the newest first: of each reader the decision that stands (for or against) when it carries a source.
// [{kind: 'choice', subject_qid, value, by, at, note, url, medium, check, found, checked_at}]
export const sourcesOf = (votes) => {
    const list = [];
    for (const [subject, rows] of group(votes, vote => vote.subject_qid)) {
        for (const state of standing(rows)) {
            const vote = state.decision;
            if (vote?.source_url && ['for', 'against'].includes(vote.value)) list.push({kind: 'choice', subject_qid: subject, value: vote.value, by: vote.username, at: new Date(vote.created_at).toISOString(), note: vote.note ?? '', ...sourceOf(vote)});
        }
    }
    return list.sort((a, b) => new Date(b.at) - new Date(a.at));
};

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
            lat: member.lat, lng: member.lng, leader: leaders.get(member.qid) ?? null, lean: leanOf(positions),
            coverage: recentCoverage(mine, now),
            positions,
        };
    });
    return {
        generated_at: now.toISOString(), levels: levelsOf(colour),
        subjects: subjects.map(subject => ({qid: subject.qid, name: subject.name, color_index: subject.color_index, status: subject.status, state: subject.state,
            origin: subject.origin ?? 'reader', found: subject.found ?? null, positions_known: known.get(subject.qid) ?? 0, uncertain_count: uncertain.get(subject.qid) ?? 0})),
        members: rows,
    };
};

// How much a position says, to put the candidates with something to say first: set by a reader or declared 3, probable 2, only uncertain sentences 1
const weightOf = (entry) => entry.human ? 3 : entry.position === 'inconnue' ? (entry.uncertain_count > 0 ? 1 : 0) : String(entry.position).endsWith('declare') ? 3 : 2;
const isoOf = (date) => new Date(date).toISOString();

// The summary of the sheet, BUILT BY THE CODE from the positions and the established signals (no AI writes anything here): for each candidate the association has something on,
// the strongest first: where it stands, and for each side the sentences said (the strongest two, word for word, with their link and who says it), who spoke, how many and in how
// many media, from when to when. positions: the positions of the sheet; history: its changes, [{subject_qid, date, from, to, kind, url, medium}]
// -> {candidates: [{subject_qid, name, color_index, status, position, ai_position, since, previous, changed, stale, signals_count, uncertain_count, articles_30d, media_30d, human, confirmed,
//    sides: [{stance, declared, probable, first_at, last_at, media, speakers: [{name, role, binds}], key: [{id, sentence, url, medium, published_at, level, speaker, role, binds}]}], latest_change}]}
export const summaryOf = ({subjects, signals, positions, history = [], colour = colourSetting()}) => {
    const byWeight = (a, b) => Number(b.level === 'declared') - Number(a.level === 'declared') || Number(BINDING.has(b.speaker_kind)) - Number(BINDING.has(a.speaker_kind))
        || new Date(b.published_at) - new Date(a.published_at);
    const candidates = [];
    for (const subject of subjects) {
        const entry = positions[subject.qid];
        if (!entry) continue;
        const established = withColour(signals.filter(signal => signal.subject_qid === subject.qid), colour).filter(signal => signal.certainty === 'established' && ['for', 'against'].includes(signal.stance));
        const sides = ['for', 'against'].map(stance => {
            const list = established.filter(signal => signal.stance === stance);
            if (list.length === 0) return null;
            const times = list.map(signal => new Date(signal.published_at).getTime());
            const speakers = [];
            for (const signal of [...list].sort((a, b) => new Date(b.published_at) - new Date(a.published_at))) {
                const name = String(signal.speaker ?? '').trim();
                if (name && !speakers.some(one => one.name === name)) speakers.push({name, role: ROLE[signal.speaker_kind] ?? '', binds: BINDING.has(signal.speaker_kind)});
            }
            const key = [];
            for (const signal of [...list].sort(byWeight)) {
                if (key.length < 2 && !key.some(one => one.url === signal.url)) {
                    key.push({id: signal.id, sentence: signal.sentence, url: signal.url, medium: signal.medium, published_at: isoOf(signal.published_at), level: signal.level,
                        speaker: String(signal.speaker ?? '').trim(), role: ROLE[signal.speaker_kind] ?? '', binds: BINDING.has(signal.speaker_kind)});
                }
            }
            return {stance, declared: list.filter(signal => signal.level === 'declared').length, probable: list.filter(signal => signal.level === 'probable').length,
                first_at: isoOf(Math.min(...times)), last_at: isoOf(Math.max(...times)), media: new Set(list.map(signal => signal.medium)).size, speakers: speakers.slice(0, 3), key};
        }).filter(Boolean);
        // the side the position stands on first
        const standing = sideOf(entry.position);
        sides.sort((a, b) => Number(b.stance === standing) - Number(a.stance === standing));
        const changes = history.filter(change => change.subject_qid === subject.qid);
        candidates.push({subject_qid: subject.qid, name: subject.name, color_index: subject.color_index, status: subject.status, position: entry.position, ai_position: entry.ai_position ?? null,
            since: entry.since ? isoOf(entry.since) : null, previous: entry.previous ?? null, changed: Boolean(entry.changed), stale: Boolean(entry.stale), signals_count: entry.signals_count ?? 0,
            uncertain_count: entry.uncertain_count ?? 0, articles_30d: entry.articles_30d ?? 0, media_30d: entry.media_30d ?? 0,
            human: entry.human ? {value: entry.human.value, by: entry.human.by, at: entry.human.at, newer_evidence: Boolean(entry.human.newer_evidence)} : null, confirmed: entry.confirmed ?? null,
            sides, latest_change: changes.length > 0 ? {...changes[changes.length - 1], date: isoOf(changes[changes.length - 1].date)} : null});
    }
    return {candidates: candidates.sort((a, b) => weightOf(b) - weightOf(a) || a.color_index - b.color_index)};
};

// What the rest of the confederation says, to put an association in its context: {confederation: {qid, fifa, name}, own: {subject_qid: {position, since}}, associations:
// {subject_qid: {for, against, unknown, total}}} - the confederation's own position on each candidate, and how the OTHER associations of it stand on each. map: the map of buildMap
// (members, subjects); null for a confederation, or when the map has no such confederation
export const contextOf = ({member, map}) => {
    if (!member || member.level === 'confederation') return null;
    const confederation = map.members.find(row => row.level === 'confederation' && row.fifa === member.confederation);
    if (!confederation) return null;
    const mates = map.members.filter(row => row.level !== 'confederation' && row.confederation === member.confederation && row.qid !== member.qid);
    const own = {};
    const associations = {};
    for (const subject of map.subjects) {
        const position = confederation.positions[subject.qid];
        if (position && position.position !== 'inconnue') own[subject.qid] = {position: position.position, since: position.since ?? null};
        const counts = {for: 0, against: 0, unknown: 0};
        for (const mate of mates) counts[sideOf(mate.positions[subject.qid]?.position) ?? 'unknown']++;
        associations[subject.qid] = {...counts, total: mates.length};
    }
    return {confederation: {qid: confederation.qid, fifa: confederation.fifa, name: confederation.name}, own, associations};
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
        positions, leader, lean: leanOf(positions), sources: sourcesOf(votes), summary: summaryOf({subjects, signals, positions, history, colour}),
        votes: [...votes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(vote => ({subject_qid: vote.subject_qid, value: vote.value, by: vote.username, at: new Date(vote.created_at).toISOString(), note: vote.note ?? '', seen: vote.seen ?? '', source: sourceOf(vote)})),
        signals: signals.filter(signal => signal.certainty !== 'discarded').sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).map(signal => ({
            id: signal.id, subject_qid: signal.subject_qid,
            certainty: signal.certainty === 'established' && withColour([signal], colour)[0].certainty === 'established' ? 'established' : 'uncertain',
            uncertain_reason: signal.certainty === 'uncertain' ? reasonFor(signal.uncertain_reason) : signal.certainty === 'established' && withColour([signal], colour)[0].certainty === 'uncertain' ? 'colour_setting' : '',
            stance: signal.stance, level: signal.level, mark: signal.mark,
            speaker: {name: signal.speaker ?? '', role: ROLE[signal.speaker_kind] ?? '', binds: ['president', 'executive', 'statement'].includes(signal.speaker_kind)},
            sentence: signal.sentence, translation: null, url: signal.url, medium: signal.medium, published_at: new Date(signal.published_at).toISOString(), lang: signal.lang,
            added_by: signal.added_by ?? null, source_id: signal.source_id ?? null,
        })),
        history,
    };
};
