//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: fifa-service.js
//  Description: The map "The FIFA presidency": the news read for the position of every association on every candidate, in the background (every
//               FIFA_WATCH_MINUTES while the server runs), and what the page asks: the map, the sheet of an association, the presidents, the
//               confederations, the candidates (a reader adds one: the 30 days of news are then read) and the votes (the latest vote of
//               a reader decides for everyone). The readings are in fifa-reading.js, the shapes in fifa-map.js
//

"use strict"

import process from 'node:process';
import {setImmediate} from 'node:timers';
import {FifaModel} from '../models/fifa-model.js';
import {ASSOCIATIONS, CONFEDERATIONS, MEMBERS, MEMBER_LIST} from './utils/fifa-members.js';
import {aliasIndexOf, norm, passagesOf} from './utils/fifa-passages.js';
import {confirmModel, readPassage, readWith} from './utils/fifa-reading.js';
import {agrees, reportOf, sampleOf, sideOf, verdictOf, votesAgainstNews} from './utils/fifa-audit.js';
import {basePosition, buildMap, buildSheet, colourSetting, leanOf, positionFor} from './utils/fifa-map.js';
import {mapWithConcurrency} from './utils/concurrency.js';
import {newUsage, ollamaJson} from './utils/ollama.js';
import {memo} from './utils/memo.js';
import {mentionKey} from './utils/mentions.js';
import {describeItems, isQid, searchItems, wikimediaHeaders} from './utils/wikidata.js';
import {leaderOfPage, pageUrl, sameName} from './utils/fifa-site.js';
import {checkOf, passagesOfPage, passagesOfSource, readingsOfPage, readSourcePage, sourceOfBody} from './utils/fifa-source.js';
import {candidateVerdictOf, collectPersons, judgmentOf, MIN_MEDIA, promptOfCandidate} from './utils/fifa-discovery.js';
import {assertPublicUrl} from './utils/public-url.js';
import {setTimeout as sleep} from 'node:timers/promises';

const WATCH_MINUTES = Number(process.env.FIFA_WATCH_MINUTES) || 30;
const FIRST_WATCH_MS = 4 * 60e3;
const LEADERS_EVERY_MS = 24 * 3600e3;
// the public pages of FIFA are read once a week, one request every 1.2 s, by a client that says who it is (FIFA_SITE_LEADERS=off reads none)
const SITE_EVERY_MS = 7 * 864e5;
const SITE_DELAY_MS = process.env.FIFA_SITE_DELAY_MS === undefined ? 1200 : Number(process.env.FIFA_SITE_DELAY_MS);
const SITE_HEADERS = {'User-Agent': 'NewsGenerator/1.0 (+https://news.fabianrostello.com; personal news reader, reads each public page once a week)', Accept: 'text/html'};
// fewer pages than this give a president: the site is down or changed, the presidents of the week before are kept
const SITE_MIN_PAGES = 100;
const BACKFILL_DAYS = 30;                 // the news we keep (RETENTION_DAYS)
const OVERLAP_MS = 10 * 60e3;             // a run reads from a little before where the last stopped
const CONCURRENCY = 3;
const RECONFIRM_PER_RUN = 20;
// What a reading of the news may cost: about 4 600 tokens a passage (2 800 for the first model, and 3 700 more for the second on the 45% it would
// colour), measured on the gold set. A candidate named in thousands of sentences would cost more than a reader thinks when adding him: the newest are read
const MAX_PASSAGES = Number(process.env.FIFA_MAX_PASSAGES) || 800;
export const MAX_SUBJECTS = 6;            // one colour each on the page
export const SUBJECT_STATUSES = ['incumbent', 'declared', 'rumoured', 'withdrawn'];
const VOTES = ['for', 'against', 'unknown', 'withdraw', 'confirm'];
// the pages a reader joins to their choices are read by the AI (up to 6 passages, about 5 000 to 28 000 tokens a page): a few a day for each reader
const SOURCES_PER_DAY = Number(process.env.FIFA_SOURCES_PER_DAY) || 20;
const SOURCE_RECHECK_PER_RUN = 10;
const NOTE_MAX = 280;
// FIFA as the tagger links it in the news (an organisation of the mentions): a news that names it is about football
const FIFA_ORG = 'Q253414';
// the candidates the news name: looked for once a day in the news of the last two weeks, a person judged is not judged again for half a day, at most two are added
// by a run (a candidate costs about 150 000 tokens to read: the 30 days of news that name him), and none takes the place of another
const DISCOVER_EVERY_MS = 24 * 3600e3;
const DISCOVER_DAYS = 14;
const JUDGED_FOR_MS = 12 * 3600e3;
const MAX_AUTO_ADDS = 2;
const FREE_NOTE_MAX = 500;
const AUDIT_DAYS = Number(process.env.FIFA_AUDIT_DAYS) || 7;
// the third model of the audit: another family than the two that read (gemma, deepseek)
const auditModel = () => process.env.FIFA_AUDIT_MODEL || 'gpt-oss:120b';

let watching = false;
let discovering = false;
const judged = new Map();
let scheduled = false;
const cache = memo({ttlMs: 60e3, max: 4});
// what the news say of the presidents (articles, the latest one) changes slowly and costs a query of the shared tables: kept a quarter of an hour
const slow = memo({ttlMs: process.env.FIFA_MENTIONS_CACHE_MS === undefined ? 15 * 60e3 : Number(process.env.FIFA_MENTIONS_CACHE_MS), max: 2});

const fail = (status, message) => Object.assign(new Error(message), {status});
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// the words of a person a sentence must hold: the last word of the name ("Kozo Tashima": "tashima"), four letters at least
export const termsOf = (label) => {
    const last = norm(String(label ?? '').trim().split(/\s+/).pop() ?? '');
    return /^[\p{L}\p{N}'-]{4,40}$/u.test(last) ? [last] : [];
};

const signalRow = (subject, passage, reading) => ({
    subject_qid: subject.qid, member_qid: passage.member.qid, hash: passage.hash, certainty: reading.status, uncertain_reason: reading.status === 'uncertain' ? reading.reason : '',
    stance: reading.stance, level: reading.status === 'discarded' ? 'none' : reading.level, mark: reading.mark, speaker_kind: reading.speaker_kind, speaker: reading.speaker, matched: passage.matched,
    sentence: passage.sentence, title: passage.article.title ?? '', description: passage.article.description ?? '', quote: reading.quote, lang: passage.article.lang, url: passage.article.url,
    medium: passage.article.medium, published_at: passage.article.date, news_count: passage.news, media_count: passage.media, read_by: reading.readBy, confirmed: reading.confirmed,
});

// the passages of the news since a date that name the candidate, read and kept: {news, passages, read, established, uncertain, discarded, byCode, failed}
const readSubject = async (subject, since, usage) => {
    const stats = {news: 0, passages: 0, read: 0, established: 0, uncertain: 0, discarded: 0, byCode: 0, failed: 0};
    const terms = subject.terms ?? [];
    if (terms.length === 0) return stats;
    const news = await FifaModel.news({regex: `(${terms.map(escapeRegex).join('|')})`, since});
    stats.news = news.length;
    if (news.length === 0) return stats;
    const qids = MEMBER_LIST.map(member => member.qid);
    const linked = new Map();
    for (let at = 0; at < news.length; at += 2000) {
        for (const row of await FifaModel.linkedNames(news.slice(at, at + 2000).map(item => item.id), qids)) linked.set(row.id, [...(linked.get(row.id) ?? []), {qid: row.qid, name: row.name}]);
    }
    const index = aliasIndexOf({members: MEMBER_LIST, mentionNames: await FifaModel.mentionNames(qids)});
    const passages = passagesOf({news, linked, index, members: MEMBERS, terms});
    stats.passages = passages.length;
    const known = await FifaModel.knownHashes(subject.qid, passages.map(passage => passage.hash));
    const unread = passages.filter(passage => !known.has(passage.hash)).sort((a, b) => b.article.date.localeCompare(a.article.date));
    const fresh = unread.slice(0, MAX_PASSAGES);
    if (unread.length > fresh.length) console.warn(`FIFA map: ${subject.name}: ${unread.length - fresh.length} older passages are left unread (FIFA_MAX_PASSAGES=${MAX_PASSAGES})`);
    const results = await mapWithConcurrency(fresh, CONCURRENCY, async (passage) => {
        const reading = await readPassage({passage, subject}, {usage});
        // a passage the code cannot attribute to the association is not kept: it would be shown under the wrong country
        if (reading.byCode) return 'byCode';
        await FifaModel.insertSignal(signalRow(subject, passage, reading));
        return reading.status;
    });
    for (const result of results) {
        if (result.status !== 'fulfilled') { stats.failed++; console.error(`FIFA map: a passage of ${subject.name} was not kept (${result.reason?.message})`); continue; }
        stats.read++;
        stats[result.value]++;
    }
    return stats;
};

// the passages whose second reading failed, read again
const reconfirm = async (usage) => {
    const rows = await FifaModel.unconfirmed(RECONFIRM_PER_RUN);
    let done = 0;
    for (const row of rows) {
        const passage = {hash: row.hash, member: MEMBERS.get(row.member_qid), matched: row.matched, sentence: row.sentence,
            article: {title: row.title, description: row.description, medium: row.medium, lang: row.lang, date: new Date(row.published_at).toISOString().slice(0, 10), url: row.url}};
        if (!passage.member) continue;
        const reading = await readPassage({passage, subject: {name: row.subject_name}}, {usage});
        if (reading.reason === 'unconfirmed') continue;
        await FifaModel.updateSignal(row.id, {certainty: reading.status, uncertain_reason: reading.status === 'uncertain' ? reading.reason : '', stance: reading.stance,
            level: reading.status === 'discarded' ? 'none' : reading.level, mark: reading.mark, speaker_kind: reading.speaker_kind, speaker: reading.speaker, quote: reading.quote,
            read_by: reading.readBy, confirmed: reading.confirmed});
        done++;
    }
    return done;
};

// --- the sources the readers join to their choice
const checking = new Set();

// The page a reader joined to a vote, read as the news are: {check: says | contradicts | unclear | unreadable} kept on the vote, with the sentence that says it. The AI
// that does not answer leaves the check "pending" (the watch makes it again, for a day), a page that cannot be read is "unreadable". Nothing here changes the colour
const checkSource = async (id, usage = newUsage()) => {
    if (checking.has(id)) return null;
    checking.add(id);
    try {
        const row = await FifaModel.voteById(id);
        if (!row?.source_url) return null;
        const finish = async (check, found = '') => { await FifaModel.setSourceCheck(id, {check, found}); cache.clear(); return check; };
        const subject = (await FifaModel.subjects()).find(one => one.qid === row.subject_qid);
        const member = MEMBERS.get(row.member_qid);
        if (!subject || !member) return finish('unreadable');
        let page = null;
        try {
            page = await readSourcePage(row.source_url);
        } catch (error) {
            console.warn(`FIFA map: the source ${row.source_url} was not read (${error.message})`);
        }
        if (!page) return finish('unreadable');
        const passages = passagesOfSource({page, url: row.source_url, member, subject, index: aliasIndexOf({members: MEMBER_LIST}), members: MEMBERS});
        if (passages.length === 0) return finish('unclear');
        const results = await mapWithConcurrency(passages, 2, (passage) => readPassage({passage, subject}, {usage}));
        const readings = passages.map((passage, at) => ({passage, reading: results[at].status === 'fulfilled' ? results[at].value : {unreadable: true}}));
        const answer = checkOf({readings, expected: row.value});
        return answer ? finish(answer.check, answer.found) : null;
    } finally {
        checking.delete(id);
    }
};

// the checks that waited (the AI did not answer, or the server was stopped): made again a few at a time; one that waited a day is told unreadable
const recheckSources = async (usage) => {
    await FifaModel.expireSources();
    await FifaModel.expirePages();
    let done = 0;
    for (const row of await FifaModel.pendingSources(SOURCE_RECHECK_PER_RUN)) if (await checkSource(row.id, usage)) done++;
    for (const row of await FifaModel.pendingPages(SOURCE_RECHECK_PER_RUN)) if (await checkPage(row.id, usage)) done++;
    return done;
};

// the source of a request: null when there is none, else {url, medium}. Only with a choice (for, against, a candidate), a public page, a few a day for each reader
const sourceFor = async (userId, source, allowed) => {
    const given = sourceOfBody(source);
    if (!given) return null;
    if (!allowed) throw fail(422, 'source: only with a choice of candidate, or a vote for or against.');
    await assertPublicUrl(given.url);
    if (await FifaModel.sourcesSince(userId, 24) >= SOURCES_PER_DAY) throw fail(429, 'Too many sources added today, try again tomorrow.');
    return given;
};

// the check starts at once, in the background: the sheet shows "pending" until it is made. FIFA_SOURCE_CHECK=off reads none (the watch neither)
const startCheck = (id) => {
    if (!id || process.env.FIFA_SOURCE_CHECK === 'off') return;
    setImmediate(() => { checkSource(id).catch(error => console.error(`FIFA map: a source was not checked (${error.message})`)); });
};
// --- the sources a reader adds on their own, with no candidate (a page about an association: the AI says which candidates it speaks of, if it does)
const checkingPages = new Set();

// The page read as the news are, for every candidate of the map: {state: says | unclear | unreadable} and the established readings (one for each candidate), kept on the
// source; and what it gave is kept as the signals of the news are (fifa_signals, source_id) and counts for the position like them (FIFA_PAGE_SIGNALS=off: it only informs).
// A page with no usable date gives uncertain signals only (its date says how old the position is). The AI that does not answer leaves it "pending" (the watch makes it
// again, for a day)
const checkPage = async (id, usage = newUsage()) => {
    if (checkingPages.has(id)) return null;
    checkingPages.add(id);
    try {
        const row = await FifaModel.sourceById(id);
        if (!row || row.state !== 'pending') return null;
        const finish = async (state, readings = []) => { await FifaModel.setPageCheck(id, {state, readings}); return state; };
        const member = MEMBERS.get(row.member_qid);
        if (!member) return finish('unreadable');
        let page = null;
        try {
            page = await readSourcePage(row.url);
        } catch (error) {
            console.warn(`FIFA map: the source ${row.url} was not read (${error.message})`);
        }
        if (!page) return finish('unreadable');
        const entries = passagesOfPage({page, url: row.url, member, subjects: await FifaModel.subjects(), index: aliasIndexOf({members: MEMBER_LIST}), members: MEMBERS});
        if (entries.length === 0) return finish('unclear');
        const results = await mapWithConcurrency(entries, 2, ({passage, subject}) => readPassage({passage, subject}, {usage}));
        const read = entries.map((entry, at) => ({...entry, reading: results[at].status === 'fulfilled' ? results[at].value : {unreadable: true}}));
        const answer = readingsOfPage(read);
        if (!answer) return null;
        if (process.env.FIFA_PAGE_SIGNALS !== 'off') {
            const dated = Number.isFinite(Date.parse(page.publishedAt)) && new Date(page.publishedAt) <= new Date();
            for (const {subject, passage, reading} of read) {
                // a passage the code cannot attribute to the association, or a reading the model could not give, is not kept
                if (reading.byCode || reading.unreadable) continue;
                const signal = {...signalRow(subject, passage, reading), source_id: id};
                if (!dated && signal.certainty === 'established') Object.assign(signal, {certainty: 'uncertain', uncertain_reason: 'other'});
                await FifaModel.insertSignal(signal);
            }
        }
        cache.clear();
        return finish(answer.check, answer.readings);
    } finally {
        checkingPages.delete(id);
    }
};

const startPageCheck = (id) => {
    if (!id || process.env.FIFA_SOURCE_CHECK === 'off') return;
    setImmediate(() => { checkPage(id).catch(error => console.error(`FIFA map: a source was not checked (${error.message})`)); });
};

// a source added on its own as the sheet gives it: {id, kind: "page", subject_qid, value, by, at, note, url, medium, check, found, checked_at, readings, mine}. subject_qid, value and
// found are the first reading (the candidate the page speaks of, for or against, the sentence), null or empty when the page says nothing clear
const pageShape = (row, userId) => {
    const readings = Array.isArray(row.readings) ? row.readings : [];
    return {id: row.id, kind: 'page', subject_qid: readings[0]?.subject_qid ?? null, value: readings[0]?.stance ?? null, by: row.username, at: new Date(row.created_at).toISOString(), note: row.note ?? '',
        url: row.url, medium: row.medium ?? '', check: row.state, found: readings[0]?.found ?? '', checked_at: row.checked_at ? new Date(row.checked_at).toISOString() : null, readings,
        mine: userId !== null && row.user_id === userId};
};

const noteOf = (note) => String(note ?? '').trim().slice(0, NOTE_MAX);
const noteShape = (note, userId) => ({id: note.id, by: note.username, at: new Date(note.created_at).toISOString(), text: note.text, mine: userId !== null && note.user_id === userId});

// the president of each association as Wikidata has it (P488, with no end): replaced once a day. Wikidata has some only
const readLeaders = async () => {
    const qids = MEMBER_LIST.map(member => member.qid);
    const query = `
SELECT ?fa ?person ?personLabel ?start WHERE {
  VALUES ?fa { ${qids.map(qid => `wd:${qid}`).join(' ')} }
  ?fa p:P488 ?statement . ?statement ps:P488 ?person .
  FILTER NOT EXISTS { ?statement pq:P582 ?end }
  OPTIONAL { ?statement pq:P580 ?start }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {headers: wikimediaHeaders()});
    if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
    const byMember = new Map();
    for (const row of (await response.json()).results.bindings) {
        const member = row.fa.value.split('/').pop();
        // one president each: the latest start when Wikidata has several
        const since = row.start?.value?.slice(0, 10) ?? '';
        const found = byMember.get(member);
        if (!found || since > found.since) byMember.set(member, {member_qid: member, person_qid: row.person.value.split('/').pop(), name: row.personLabel?.value ?? '', role: 'President', since});
    }
    return [...byMember.values()].filter(leader => leader.name && !/^Q\d+$/.test(leader.name));
};

// The president of each association as its public page of FIFA gives it: Map(member qid -> {name, url}), only the pages that name one
const readSiteLeaders = async () => {
    const found = new Map();
    for (const member of ASSOCIATIONS) {
        try {
            const response = await fetch(pageUrl(member.fifa), {headers: SITE_HEADERS, signal: AbortSignal.timeout(25000)});
            const leader = response.ok ? leaderOfPage(await response.text()) : null;
            if (leader) found.set(member.qid, {name: leader.name, url: pageUrl(member.fifa)});
        } catch (error) {
            console.error(`FIFA map: the page of ${member.fifa} on the site of FIFA (${error.message})`);
        }
        if (SITE_DELAY_MS > 0) await sleep(SITE_DELAY_MS);
    }
    return found;
};

// A candidate put on the map: a reader adds one (origin "reader"; a full map makes room by itself with the oldest candidate marked withdrawn), or the news bring one
// (origin "news", found = what was found; evict false: a full map takes none). Answers {subject, already}
const createSubject = async ({qid, status, userId, origin, found = null, evict = true}) => {
    const existing = (await FifaModel.subjects()).find(subject => subject.qid === qid);
    if (existing) return {subject: existing, already: true};
    const [item] = await describeItems([qid]);
    if (!item) throw fail(422, 'qid: Wikidata does not know this item.');
    if (!item.human) throw fail(422, 'qid: this item is not a person.');
    const terms = termsOf(item.label);
    if (terms.length === 0) throw fail(422, 'The name of this person is too short to look for in the news.');
    // six colours: when the map is full the oldest candidate marked "withdrawn" makes room, no administrator involved; none withdrawn, no room
    const all = await FifaModel.subjects();
    if (all.length >= MAX_SUBJECTS) {
        const withdrawn = evict ? all.filter(subject => subject.status === 'withdrawn').sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : [];
        if (withdrawn.length === 0) throw fail(409, `The map shows ${MAX_SUBJECTS} candidates at most: mark one as withdrawn to make room.`);
        await FifaModel.deleteSubject(withdrawn[0].qid);
    }
    const [subject] = await FifaModel.addSubject({qid, name: item.label, terms, status, userId, origin, found});
    if (!subject) return {subject: (await FifaModel.subjects()).find(row => row.qid === qid), already: true};
    cache.clear();
    // read now, not at the next run: the reader who added the person waits for it
    setImmediate(() => FifaService.watch().catch(error => console.error(`FIFA map: ${error.message}`)));
    return {subject, already: false};
};

export const FifaService = {
    // --- what the page reads
    // fresh: not the answer kept for a minute (the audit counts the votes as they are)
    map: async ({fresh = false} = {}) => {
        const kept = fresh ? undefined : cache.get('map');
        if (kept) return kept;
        const [subjects, signals, votes, leaders] = await Promise.all([FifaModel.subjects(), FifaModel.signals(), FifaModel.votes(), FifaModel.leaders()]);
        const answer = buildMap({members: MEMBER_LIST, subjects, signals, votes, colour: colourSetting(),
            leaders: new Map(leaders.map(leader => [leader.member_qid, {name: leader.name, role: leader.role, person_qid: leader.person_qid, since: leader.since ? new Date(leader.since).toISOString().slice(0, 10) : null}]))});
        cache.set('map', answer);
        return answer;
    },

    // userId: the reader asking, to tell the notes they wrote (mine)
    association: async (qid, userId = null) => {
        const member = MEMBERS.get(qid);
        if (!member) throw fail(404, 'No such association.');
        const [subjects, signals, votes, leaders, notes, pages] = await Promise.all([FifaModel.subjects(), FifaModel.signalsOf(qid), FifaModel.votesOf(qid), FifaModel.leaders(), FifaModel.notesOf(qid), FifaModel.pagesOf(qid)]);
        const leader = leaders.find(row => row.member_qid === qid);
        const sheet = buildSheet({member, subjects, signals, votes, colour: colourSetting(),
            leader: leader ? {name: leader.name, role: leader.role, person_qid: leader.person_qid, since: leader.since ? new Date(leader.since).toISOString().slice(0, 10) : null} : null});
        // the sources of the choices that stand and the ones added on their own, the newest first
        return {...sheet, sources: [...sheet.sources, ...pages.map(page => pageShape(page, userId))].sort((a, b) => new Date(b.at) - new Date(a.at)), notes: notes.map(note => noteShape(note, userId))};
    },

    // The news of the last 30 days that name the president of an association, the newest first, a page of them (limit 1 to 100, 50 by default; offset). The same news the
    // number of articles of the presidents counts. scope "football" (the default): only the news about football, those that also name (linked by the tagger) the association,
    // its confederation or FIFA, or hold a football word; "all": every news that names the person. total counts the scope asked, total_all every news of the person and
    // total_football the football ones, so the page says what the filter hides. {leader: {name, person_qid} | null, scope, total, total_all, total_football, limit, offset,
    // articles: [{id, title, description, medium, url, lang, published_at, relevant}]}
    leaderNews: async ({qid, limit = 50, offset = 0, scope = 'football'}) => {
        if (!MEMBERS.has(qid)) throw fail(404, 'No such association.');
        const asked = scope === undefined || scope === '' ? 'football' : scope;
        if (!['football', 'all'].includes(asked)) throw fail(422, 'scope: football or all.');
        const size = Math.min(100, Math.max(1, Math.trunc(Number(limit)) || 50));
        const skip = Math.max(0, Math.trunc(Number(offset)) || 0);
        const leader = (await FifaModel.leaders()).find(row => row.member_qid === qid);
        if (!leader) return {leader: null, scope: asked, total: 0, total_all: 0, total_football: 0, limit: size, offset: skip, articles: []};
        const confederation = CONFEDERATIONS.find(item => item.fifa === MEMBERS.get(qid).confederation);
        const orgs = [...new Set([qid, confederation?.qid, FIFA_ORG].filter(Boolean))];
        const {total, total_all: totalAll, total_football: totalFootball, rows} = await FifaModel.newsOfLeader({qid: leader.person_qid ?? null, key: mentionKey(leader.name), orgs, scope: asked, limit: size, offset: skip});
        return {leader: {name: leader.name, person_qid: leader.person_qid ?? null}, scope: asked, total, total_all: totalAll, total_football: totalFootball, limit: size, offset: skip, articles: rows.map(row => ({
            id: row.id, title: row.title ?? '', description: String(row.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 280), medium: row.medium ?? '', url: row.link, lang: row.lang ?? null,
            published_at: new Date(row.at).toISOString(), relevant: Boolean(row.relevant)}))};
    },

    // --- the notes: a word on an association, visible to every reader. 1 to 500 characters; the author or an administrator takes it off
    addNote: async ({userId, member, text}) => {
        if (!MEMBERS.has(member)) throw fail(422, 'member: no such association.');
        const clean = String(text ?? '').trim();
        if (clean === '' || clean.length > FREE_NOTE_MAX) throw fail(422, `text: 1 to ${FREE_NOTE_MAX} characters.`);
        const note = await FifaModel.addNote({userId, memberQid: member, text: clean});
        return {note: noteShape(note, userId)};
    },

    removeNote: async ({id, userId, admin = false}) => {
        const note = await FifaModel.noteById(Number(id));
        if (!note) throw fail(404, 'No such note.');
        if (note.user_id !== userId && !admin) throw fail(403, 'Only its author or an administrator takes a note off.');
        await FifaModel.deleteNote(note.id);
    },

    // --- a source added on its own, with no candidate: the link of a page about an association (a word of the reader, 280 characters). The AI reads it for every candidate
    // of the map and says which it speaks of (for or against), if it does; it informs and decides nothing. The same checks as the source of a choice (a public page, 20 a day)
    addSource: async ({userId, member, source, note = ''}) => {
        if (!MEMBERS.has(member)) throw fail(422, 'member: no such association.');
        const given = await sourceFor(userId, source, true);
        if (!given) throw fail(422, 'source: the address of the page.');
        const row = await FifaModel.addSource({userId, memberQid: member, url: given.url, medium: given.medium, note: noteOf(note)});
        if (row.state === 'pending') startPageCheck(row.id);
        return {source: pageShape(row, userId)};
    },

    // the reader who added it or an administrator takes it off
    removeSource: async ({id, userId, admin = false}) => {
        const row = await FifaModel.sourceById(Number(id));
        if (!row) throw fail(404, 'No such source.');
        if (row.user_id !== userId && !admin) throw fail(403, 'Only its author or an administrator takes a source off.');
        await FifaModel.deletePage(row.id);
    },

    // the check of a source added on its own, by its id (what the background makes; for the scripts and the tests)
    checkPage: (id) => checkPage(id),

    // The presidents, each with what the news of the last 30 days say of him: the articles that name him and the latest one (medium, link, title). The mentions
    // are a bonus: when the query fails the presidents are still given
    presidents: async () => {
        const kept = slow.get('presidents');
        if (kept) return kept;
        const rows = (await FifaModel.leaders()).filter(row => MEMBERS.has(row.member_qid));
        const asked = rows.map((row, at) => ({lid: at + 1, qid: row.person_qid ?? null, key: mentionKey(row.name)}));
        const {counts, latest} = await FifaModel.mentionsOfLeaders(asked).catch(error => { console.error(`FIFA map: the mentions of the presidents (${error.message})`); return {counts: [], latest: []}; });
        const count = new Map(counts.map(row => [row.lid, row]));
        const last = new Map(latest.map(row => [row.lid, row]));
        const answer = {
            generated_at: new Date().toISOString(),
            presidents: rows.map((row, at) => ({
                person_qid: row.person_qid, name: row.name, role: row.role, since: row.since ? new Date(row.since).toISOString().slice(0, 10) : null,
                checked_at: new Date(row.checked_at).toISOString(), member_qid: row.member_qid, source: row.source ?? 'wikidata', source_url: row.source_url ?? '',
                articles_30d: count.get(at + 1)?.articles ?? 0,
                last_mention: last.has(at + 1) ? {at: new Date(last.get(at + 1).at).toISOString(), medium: last.get(at + 1).medium, url: last.get(at + 1).link, title: last.get(at + 1).title} : null,
            })),
        };
        slow.set('presidents', answer);
        return answer;
    },

    confederations: async () => {
        const leaders = new Map((await FifaModel.leaders()).map(row => [row.member_qid, row]));
        return {generated_at: new Date().toISOString(), confederations: CONFEDERATIONS.map(item => ({
            qid: item.qid, fifa: item.fifa, name: item.name, association: item.association, level: item.level, confederation: item.confederation, iso: null, lat: null, lng: null,
            leader: leaders.has(item.qid) ? {name: leaders.get(item.qid).name, role: leaders.get(item.qid).role, person_qid: leaders.get(item.qid).person_qid, since: null} : null,
            members_count: ASSOCIATIONS.filter(member => member.confederation === item.fifa).length}))};
    },

    subjects: async () => ({generated_at: new Date().toISOString(), subjects: (await FifaService.map()).subjects}),

    // --- the candidates: any reader adds one (no validation) and changes its status; only an administrator takes one off the map
    // people the reader may pick: persons of Wikidata whose name starts with q, [{qid, name, description}]
    people: async (q) => {
        const found = await searchItems(q);
        if (found.length === 0) return {people: []};
        const humans = new Set((await describeItems(found.map(item => item.qid))).filter(item => item.human).map(item => item.qid));
        return {people: found.filter(item => humans.has(item.qid)).map(item => ({qid: item.qid, name: item.label, description: item.description ?? ''}))};
    },

    // {subject, already}: the person must be a human of Wikidata; at most MAX_SUBJECTS on the map (one colour each); the news of the 30 days are read in the background
    addSubject: async ({qid, status = 'declared', userId}) => {
        if (!isQid(qid)) throw fail(422, 'qid: the item of Wikidata of the person.');
        if (!SUBJECT_STATUSES.includes(status) || status === 'incumbent') throw fail(422, 'status: declared, rumoured or withdrawn.');
        return createSubject({qid, status, userId, origin: 'reader'});
    },

    // --- the candidates the news name
    // The persons the news of the last days name as candidates for the presidency of FIFA (fifa-discovery.js), judged by two models, and added to the map when both say it in
    // enough media. apply false: nothing is added, the answer says what would be. Answers {news, persons, judged: [{qid, name, media, articles, add, status, why, quote}], added, full}
    discover: async ({days = DISCOVER_DAYS, apply = true} = {}) => {
        if (discovering) return {skipped: true};
        discovering = true;
        try {
            const usage = newUsage();
            const subjects = await FifaModel.subjects();
            const skip = new Set([...subjects.map(subject => subject.qid), ...(await FifaModel.dismissed())]);
            const news = (await FifaModel.discoveryNews({since: new Date(Date.now() - days * 864e5)})).sort((a, b) => new Date(b.at) - new Date(a.at));
            const found = collectPersons({news, persons: await FifaModel.personsOfArticles(news.map(item => item.id)), skip});
            const answer = {news: news.length, persons: found.size, judged: [], added: [], full: false, tokens: usage};
            const ask = async (prompt, samples, model, think) => {
                try {
                    return judgmentOf(await ollamaJson(prompt, usage, {...(model ? {model, fallback: null} : {}), think, timeoutMs: 240000}), samples);
                } catch (error) {
                    console.warn(`FIFA map: a candidate was not judged (${String(error.message).slice(0, 80)})`);
                    return null;
                }
            };
            // a person named in fewer media than the lowest bar is not even asked about
            for (const one of [...found.values()].filter(person => person.media.size >= MIN_MEDIA.declared).sort((a, b) => b.media.size - a.media.size)) {
                const before = judged.get(one.qid);
                if (before && Date.now() - before.at < JUDGED_FOR_MS) continue;
                const prompt = promptOfCandidate(one);
                const first = await ask(prompt, one.samples, process.env.FIFA_MODEL || null, false);
                const second = first && first.status !== 'no' ? await ask(prompt, one.samples, confirmModel(), true) : first;
                const verdict = candidateVerdictOf({first, second, media: one.media.size});
                if (verdict.why !== 'unread') judged.set(one.qid, {at: Date.now()});
                const line = {qid: one.qid, name: one.name, media: one.media.size, articles: one.articles.size, ...verdict};
                answer.judged.push(line);
                if (!verdict.add || !apply) continue;
                if (subjects.length + answer.added.length >= MAX_SUBJECTS) { answer.full = true; continue; }
                if (answer.added.length >= MAX_AUTO_ADDS) continue;
                try {
                    const result = await createSubject({qid: one.qid, status: verdict.status, userId: null, origin: 'news', evict: false,
                        found: {status: verdict.status, articles: one.articles.size, media: one.media.size, quote: verdict.quote, at: new Date().toISOString()}});
                    if (!result.already) answer.added.push(line);
                } catch (error) {
                    console.warn(`FIFA map: ${one.name} was not added (${error.message})`);
                }
            }
            if (answer.added.length > 0) console.log(`FIFA map: candidates found in the news and added: ${answer.added.map(one => `${one.name} (${one.status}, ${one.media} media)`).join(', ')}`);
            return answer;
        } finally {
            discovering = false;
        }
    },

    // any reader: declared, rumoured or withdrawn say where the candidate stands, they colour nothing
    setStatus: async (qid, status) => {
        if (!SUBJECT_STATUSES.includes(status)) throw fail(422, 'status: incumbent, declared, rumoured or withdrawn.');
        if (!(await FifaModel.subjects()).some(subject => subject.qid === qid)) throw fail(404, 'No such candidate.');
        await FifaModel.setSubjectStatus(qid, status);
        cache.clear();
    },

    removeSubject: async (qid) => {
        if (!(await FifaModel.subjects()).some(subject => subject.qid === qid)) throw fail(404, 'No such candidate.');
        await FifaModel.deleteSubject(qid);
        // the news do not bring back a candidate an administrator took off
        await FifaModel.dismiss(qid);
        cache.clear();
    },

    // --- the votes: {ok, human, confirmed}, human the vote that decides AFTER this one (with the news since), confirmed who confirmed the position.
    // "confirm" is a validation by hand: it records which position the reader saw and makes it solid (see fifa-map.js). source: the page that says it ({url}), with a
    // vote for or against only; it is read by the AI and shown (pending, then says / contradicts / unclear / unreadable), it never changes the colour
    vote: async ({userId, subject, member, value, note = '', source = null}) => {
        if (!VOTES.includes(value)) throw fail(422, 'value: for, against, unknown, withdraw or confirm.');
        if (!MEMBERS.has(member)) throw fail(422, 'member: no such association.');
        if (!(await FifaModel.subjects()).some(row => row.qid === subject)) throw fail(422, 'subject: no such candidate.');
        const joined = await sourceFor(userId, source, value === 'for' || value === 'against');
        const pair = async () => ({signals: (await FifaModel.signalsOf(member)).filter(signal => signal.subject_qid === subject),
            votes: await FifaModel.votesOfPair(subject, member), colour: colourSetting(), now: new Date()});
        const positionNow = async () => positionFor(await pair());
        // the position the reader confirms: the one a reader set, else the one the news gave (not the solid colour another confirmation gave it)
        const seen = value === 'confirm' ? basePosition(await pair()) : '';
        const added = await FifaModel.addVote({userId, subjectQid: subject, memberQid: member, value, note: noteOf(note), seen, source: joined});
        if (joined) startCheck(added?.[0]?.id);
        cache.clear();
        const after = await positionNow();
        return {ok: true, human: after?.human ?? null, confirmed: after?.confirmed ?? null};
    },

    // The reader says which candidate an association leans toward, when no candidate is chosen on the page. subject: the item of a candidate, "none" (it leans toward
    // none: undecided) or "withdraw" (the reader takes their choice back). An association has one vote, so choosing a candidate sets it FOR him and, for each other
    // candidate it is shown supporting (the news or another reader), "no position": the reader's word replaces it. Opposition is never inferred or touched. All the
    // votes of a choice are written together; a choice already standing writes nothing, unless the reader joins a page that is not the one it stands on. source: the page
    // that says it ({url}), joined to the choice of a candidate (read by the AI, shown, it never changes the colour); note: a word of the reader (280 characters)
    // Answers {ok, positions, lean}: what the page puts in its map
    lean: async ({userId, member, subject, source = null, note = ''}) => {
        if (!MEMBERS.has(member)) throw fail(422, 'member: no such association.');
        const subjects = await FifaModel.subjects();
        if (!['none', 'withdraw'].includes(subject) && !subjects.some(row => row.qid === subject)) throw fail(422, 'subject: a candidate, "none" or "withdraw".');
        const joined = await sourceFor(userId, source, !['none', 'withdraw'].includes(subject));
        const read = async () => {
            const [signals, votes] = await Promise.all([FifaModel.signalsOf(member), FifaModel.votesOf(member)]);
            return {signals, votes};
        };
        const {signals, votes} = await read();
        const colour = colourSetting();
        const standing = (qid, data) => positionFor({signals: data.signals.filter(signal => signal.subject_qid === qid), votes: data.votes.filter(vote => vote.subject_qid === qid), colour, now: new Date()});
        // the latest decision of this reader on a candidate (a confirmation is no decision), none when they took it back
        const decision = (qid) => {
            const own = votes.filter(vote => vote.subject_qid === qid && vote.user_id === userId && vote.value !== 'confirm')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
            return own && own.value !== 'withdraw' ? own : null;
        };
        const mine = (qid) => decision(qid)?.value ?? null;
        const writes = [];
        for (const row of subjects) {
            if (subject === 'withdraw') {
                if (mine(row.qid) !== null || votes.some(vote => vote.subject_qid === row.qid && vote.user_id === userId && vote.value === 'confirm')) writes.push({subjectQid: row.qid, memberQid: member, value: 'withdraw'});
            } else if (row.qid === subject) {
                if (mine(row.qid) !== 'for' || (joined && decision(row.qid)?.source_url !== joined.url)) writes.push({subjectQid: row.qid, memberQid: member, value: 'for', note: noteOf(note), source: joined});
            } else if (sideOf(standing(row.qid, {signals, votes})?.position) === 'for' && mine(row.qid) !== 'unknown') {
                writes.push({subjectQid: row.qid, memberQid: member, value: 'unknown'});
            }
        }
        const added = await FifaModel.addVotes(userId, writes);
        const withSource = writes.findIndex(write => write.source);
        if (withSource >= 0) startCheck(added?.[withSource]?.[0]?.id);
        cache.clear();
        const after = await read();
        const positions = {};
        for (const row of subjects) {
            const position = standing(row.qid, after);
            if (position) positions[row.qid] = position;
        }
        return {ok: true, positions, lean: leanOf(positions), written: writes.length};
    },

    // an administrator takes a vote off (a vandal's)
    removeVote: async (id) => {
        await FifaModel.deleteVote(Number(id));
        cache.clear();
    },

    // the check of a source, by the id of the vote (what the background makes; for the scripts and the tests)
    checkSource: (id) => checkSource(id),

    // --- when a rule of the guide changes
    // The established signals of a FAMILY (their words match `pattern`, a regular expression of Postgres) read again with the rules of now, one by one by the same
    // reading as the news that come: the family is corrected by the logic, no line by hand. apply false: nothing is written, the answer says what would change.
    // reason: the reason of the rule that changed (uncertain "praise"): only a change that comes from it is kept; the others ("readings_disagree": the two
    // models do not give the same answer every time, 3 of 23 here) are told as noise and never written, or a family read again would lose true positives.
    // {read, unchanged, unread, changed: [{id, member, before, after, reason, sentence}], noise: [...], applied}
    reread: async ({pattern, reason = null, apply = false}) => {
        if (typeof pattern !== 'string' || pattern.trim() === '') throw fail(422, 'pattern: the words of the family.');
        const rows = await FifaModel.establishedMatching(pattern);
        const usage = newUsage();
        const results = await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
            const passage = {hash: row.hash, member: MEMBERS.get(row.member_qid), matched: row.matched, sentence: row.sentence,
                article: {title: row.title, description: row.description, medium: row.medium, lang: row.lang, date: new Date(row.published_at).toISOString().slice(0, 10), url: row.url}};
            if (!passage.member) return null;
            return readPassage({passage, subject: {name: row.subject_name}}, {usage});
        });
        const answer = {read: rows.length, unchanged: 0, unread: 0, changed: [], noise: [], applied: 0, tokens: usage};
        for (let at = 0; at < rows.length; at++) {
            const row = rows[at];
            const reading = results[at].status === 'fulfilled' ? results[at].value : null;
            // a reading the model could not give (unconfirmed) is no new word: the signal stays as it is
            if (!reading || reading.reason === 'unconfirmed' || reading.unreadable) { answer.unread++; continue; }
            const same = reading.status === 'established' && reading.stance === row.stance && reading.level === row.level;
            if (same) { answer.unchanged++; continue; }
            const one = {id: row.id, member: MEMBERS.get(row.member_qid)?.fifa, before: `established ${row.stance}/${row.level}`,
                after: reading.status === 'established' ? `established ${reading.stance}/${reading.level}` : reading.status, reason: reading.reason ?? '', sentence: String(row.sentence).replace(/\s+/g, ' ').slice(0, 200)};
            if (reason !== null && !(reading.status === 'uncertain' && reading.reason === reason)) { answer.noise.push(one); continue; }
            answer.changed.push(one);
            if (apply) {
                await FifaModel.updateSignal(row.id, {certainty: reading.status, uncertain_reason: reading.status === 'uncertain' ? reading.reason : '', stance: reading.stance,
                    level: reading.status === 'discarded' ? 'none' : reading.level, mark: reading.mark, speaker_kind: reading.speaker_kind, speaker: reading.speaker, quote: reading.quote,
                    read_by: reading.readBy, confirmed: reading.confirmed});
                answer.applied++;
            }
        }
        if (apply) cache.clear();
        return answer;
    },

    // --- the audit
    // A sample of the established signals (the ones of the last days first) read again by a third model, and the votes of the readers against the news:
    // {auditor, sampled, agreed, unreadable, votes_total, votes_contradicting, verdict, details, report}. dry: nothing is kept
    audit: async ({days = AUDIT_DAYS, sample = 30, dry = false} = {}) => {
        const auditor = auditModel();
        const rows = sampleOf(await FifaModel.auditSample({days}), sample);
        const usage = newUsage();
        const readings = await mapWithConcurrency(rows, 2, async (row) => {
            const passage = {hash: row.hash, member: MEMBERS.get(row.member_qid), matched: row.matched, sentence: row.sentence,
                article: {title: row.title, description: row.description, medium: row.medium, lang: row.lang, date: new Date(row.published_at).toISOString().slice(0, 10), url: row.url}};
            return readWith({passage, subject: {name: row.subject_name}}, {model: auditor, usage});
        });
        let agreed = 0, unreadable = 0;
        const disagreements = [];
        readings.forEach((result, at) => {
            const reading = result.status === 'fulfilled' ? result.value : null;
            if (!reading) { unreadable++; return; }
            if (agrees(reading, rows[at])) agreed++;
            else disagreements.push({id: rows[at].id, member: MEMBERS.get(rows[at].member_qid)?.fifa, sentence: rows[at].sentence.slice(0, 200), stance: rows[at].stance, auditor: reading.status, reason: reading.reason});
        });
        const sampled = rows.length - unreadable;
        const votes = votesAgainstNews(await FifaService.map({fresh: true}));
        const verdict = verdictOf({sampled, agreed});
        const audit = {auditor, sampled, agreed, unreadable, votes_total: votes.voted, votes_contradicting: votes.contradicts, verdict,
            details: {disagreements, contradicting: votes.contradicting, tokens: usage}};
        if (!dry) await FifaModel.addAudit(audit);
        return {...audit, report: reportOf({sampled, agreed, unreadable, auditor, votes, verdict, disagreements})};
    },

    // the last audits, for an administrator
    audits: async (limit = 12) => ({audits: (await FifaModel.audits(limit)).map(row => ({...row, made_at: new Date(row.made_at).toISOString()}))}),

    // --- the watch
    // Every candidate is read for the news created since the last run (the first time the 30 days), then the passages whose second reading failed are read
    // again, and the presidents are renewed once a day. One run at a time; a candidate that fails leaves the others and is read again from where it was
    watch: async () => {
        if (watching) return {skipped: true};
        watching = true;
        try {
            const usage = newUsage();
            const started = Date.now();
            let read = 0;
            for (const subject of await FifaModel.subjects()) {
                const first = subject.state === 'computing' || !subject.checked_at;
                const runStart = new Date();
                const since = first ? new Date(runStart.getTime() - BACKFILL_DAYS * 864e5) : new Date(new Date(subject.checked_at).getTime() - OVERLAP_MS);
                try {
                    const stats = await readSubject(subject, since, usage);
                    await FifaModel.markChecked(subject.qid, runStart, first);
                    read += stats.read;
                    if (stats.read > 0 || first) console.log(`FIFA map: ${subject.name}${first ? ' (first reading, 30 days)' : ''}: ${stats.news} news, ${stats.passages} passages, ${stats.read} read (${stats.established} established, ${stats.uncertain} uncertain, ${stats.discarded} discarded, ${stats.byCode} not attributed${stats.failed ? `, ${stats.failed} failed` : ''})`);
                } catch (error) {
                    console.error(`FIFA map: ${subject.name} was not read (${error.message})`);
                }
            }
            const again = await reconfirm(usage).catch(error => { console.error(`FIFA map: second readings (${error.message})`); return 0; });
            const sources = process.env.FIFA_SOURCE_CHECK === 'off' ? 0 : await recheckSources(usage).catch(error => { console.error(`FIFA map: sources of the readers (${error.message})`); return 0; });
            cache.clear();
            if (read > 0 || again > 0 || sources > 0) console.log(`FIFA map: ${read} passages read, ${again} read again, ${sources} sources checked, ${Math.round((Date.now() - started) / 1000)} s, tokens ${JSON.stringify(usage)}`);
            return {read, again, sources};
        } finally {
            watching = false;
        }
    },

    // The presidents: the page of each association on the site of FIFA first (the associations give it themselves; read once a week), with the item of Wikidata of
    // the person when Wikidata has the same one, else Wikidata alone (read every day). A day with Wikidata not answering, or a week with the site of FIFA down
    // or changed (fewer than SITE_MIN_PAGES pages give a president), leaves the presidents of the time before
    refreshLeaders: async () => {
        const wikidata = await readLeaders();
        const before = await FifaModel.leaders();
        const fromSite = new Map(before.filter(row => row.source === 'fifa').map(row => [row.member_qid, {name: row.name, url: row.source_url}]));
        const lastSite = Math.max(0, ...before.filter(row => row.source === 'fifa').map(row => new Date(row.checked_at).getTime()));
        let site = fromSite;
        if (process.env.FIFA_SITE_LEADERS !== 'off' && (fromSite.size === 0 || Date.now() - lastSite > SITE_EVERY_MS)) {
            const read = await readSiteLeaders();
            if (read.size >= SITE_MIN_PAGES) site = read;
            else console.error(`FIFA map: the site of FIFA gave ${read.size} presidents, kept the ones of before`);
        }
        if (process.env.FIFA_SITE_LEADERS === 'off') site = new Map();
        const wiki = new Map(wikidata.map(row => [row.member_qid, row]));
        const leaders = [];
        for (const member of MEMBER_LIST) {
            const named = site.get(member.qid);
            const other = wiki.get(member.qid);
            if (named) leaders.push({member_qid: member.qid, person_qid: other && sameName(named.name, other.name) ? other.person_qid : null, name: named.name, role: 'President',
                since: other && sameName(named.name, other.name) ? other.since : '', source: 'fifa', source_url: named.url});
            else if (other) leaders.push({...other, source: 'wikidata', source_url: ''});
        }
        if (leaders.length > 0) await FifaModel.replaceLeaders(leaders);
        cache.clear();
        slow.clear();
        return leaders.length;
    },

    // every FIFA_WATCH_MINUTES while the server runs (the server that reads the news: INGEST_IN_SERVER), the first time soon after it starts
    schedule: () => {
        if (scheduled) return;
        scheduled = true;
        let said = false;
        const guard = (task, label) => task().catch(error => {
            // the tables are made by db/add_fifa_map.sql: said once until it is run
            if (/relation "fifa_/.test(error.message)) {
                if (!said) console.error('FIFA map: the reading waits for db/add_fifa_map.sql to be run');
                said = true;
                return;
            }
            console.error(`FIFA map: ${label} failed (${error.message})`);
        });
        setTimeout(() => guard(FifaService.watch, 'the reading'), FIRST_WATCH_MS).unref();
        setInterval(() => guard(FifaService.watch, 'the reading'), WATCH_MINUTES * 60e3).unref();
        // the candidates the news name, once a day (FIFA_DISCOVER=off looks for none)
        if (process.env.FIFA_DISCOVER !== 'off') {
            setTimeout(() => guard(FifaService.discover, 'the candidates of the news'), FIRST_WATCH_MS + 3 * 60e3).unref();
            setInterval(() => guard(FifaService.discover, 'the candidates of the news'), DISCOVER_EVERY_MS).unref();
        }
        setTimeout(() => guard(FifaService.refreshLeaders, 'the presidents'), FIRST_WATCH_MS + 60e3).unref();
        setInterval(() => guard(FifaService.refreshLeaders, 'the presidents'), LEADERS_EVERY_MS).unref();
        // the audit once a week (FIFA_AUDIT_DAYS): checked every hour, made when the last one is older (a deploy does not start the week again)
        const auditIfDue = async () => {
            const last = await FifaModel.lastAudit();
            if (last && Date.now() - new Date(last.made_at).getTime() < AUDIT_DAYS * 864e5) return;
            const result = await FifaService.audit();
            (result.verdict === 'warning' ? console.warn : console.log)(result.report);
        };
        setTimeout(() => guard(auditIfDue, 'the audit'), FIRST_WATCH_MS + 8 * 60e3).unref();
        setInterval(() => guard(auditIfDue, 'the audit'), 3600e3).unref();
    },
};
