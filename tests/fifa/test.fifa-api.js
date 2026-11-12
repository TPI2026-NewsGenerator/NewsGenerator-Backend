//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-api.js
//  Description: /api/fifa, the routes of the map "The FIFA presidency" (the session of a reader): what the page reads (the shapes of the contract of the
//               client), the votes (the latest vote of each reader decides, a vote taken back counts for nothing), a reader adding a candidate with no
//               validation (a person, at most six, three a day, a full map making room by itself with the oldest withdrawn) and what only an
//               administrator does. The database, the AI and Wikidata are mocked; what the AI reads is measured on the gold set (bench/fifa)
//

import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';

// the mentions of the presidents are kept a quarter of an hour: not here, each test asks again
process.env.FIFA_MENTIONS_CACHE_MS = '0';
const model = Object.fromEntries(['subjects', 'addSubject', 'markChecked', 'setSubjectStatus', 'deleteSubject', 'news', 'linkedNames', 'mentionNames', 'knownHashes', 'insertSignal',
    'unconfirmed', 'updateSignal', 'signals', 'signalsOf', 'votes', 'votesOf', 'votesOfPair', 'addVote', 'deleteVote', 'leaders', 'replaceLeaders', 'audits', 'auditSample', 'lastAudit', 'addAudit', 'mentionsOfLeaders', 'addVotes', 'voteById', 'setSourceCheck', 'sourcesSince', 'expireSources', 'pendingSources', 'notesOf', 'addNote', 'noteById', 'deleteNote', 'dismiss', 'dismissed', 'addSource', 'sourceById', 'setPageCheck', 'pagesOf', 'pendingPages', 'expirePages', 'deletePage', 'newsOfLeader'].map(name => [name, jest.fn()]));
// the address of a source is checked against the network of the server with a DNS lookup: not here
const publicUrl = await import('../../services/utils/public-url.js');
jest.unstable_mockModule('../../services/utils/public-url.js', () => ({...publicUrl, assertPublicUrl: jest.fn(async (value) => new URL(value))}));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn(), newUsage: () => ({calls: 0, input: 0, output: 0})}));
const wikidata = {searchItems: jest.fn(), describeItems: jest.fn(), isQid: (value) => /^Q[1-9]\d*$/.test(String(value)), wikimediaHeaders: () => ({})};
jest.unstable_mockModule('../../services/utils/wikidata.js', () => wikidata);
// who is signed in, and whether they are an administrator, as the headers of the test say
jest.unstable_mockModule('../../services/utils/jwt.js', () => ({authenticateToken: (req, res, next) => {
    if (req.headers['x-user'] === undefined) return res.status(401).json({error: 'Unauthorized'});
    req.user = {id: Number(req.headers['x-user']), username: `reader${req.headers['x-user']}`};
    next();
}}));
// the reader 1000 is an administrator for the routes that ask the role of the signed-in reader
jest.unstable_mockModule('../../services/utils/admin.js', () => ({adminOnly: (refused) => (req, res, next) => req.headers['x-admin'] === '1' ? next() : res.status(403).json({error: refused}), isAdmin: async (userId) => userId === 1000}));
const {default: fifaRouter} = await import('../../routes/fifa-router.js');

const app = express();
app.use(express.json());
app.use('/api/fifa', fifaRouter);
let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const call = (path, {method = 'GET', user, admin = false, body} = {}) => new Promise((resolve, reject) => {
    const headers = {'Content-Type': 'application/json'};
    if (user !== undefined) headers['x-user'] = String(user);
    if (admin) headers['x-admin'] = '1';
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/api/fifa${path}`, method, headers}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, body: text === '' ? null : JSON.parse(text)}));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
});

const INFANTINO = {qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino'], status: 'incumbent', state: 'ready', color_index: 1, created_at: '2026-11-01T00:00:00Z', checked_at: new Date(), backfilled_at: new Date()};
const JAPAN = 'Q579842';
const signal = {id: 1, subject_qid: INFANTINO.qid, member_qid: JAPAN, certainty: 'established', uncertain_reason: '', stance: 'against', level: 'declared', mark: 'official', speaker_kind: 'president',
    speaker: 'Someone', sentence: 'The JFA will not back Infantino.', lang: 'en', url: 'https://example.com/1', medium: 'example.com', published_at: new Date('2026-11-01T10:00:00Z'), news_count: 2, media_count: 1, confirmed: true};
let nextUser = 100;
const reader = () => ++nextUser;

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    model.mentionsOfLeaders.mockResolvedValue({counts: [], latest: []});
    for (const name of ['subjects', 'signals', 'signalsOf', 'votes', 'votesOf', 'votesOfPair', 'leaders', 'news', 'unconfirmed', 'mentionNames', 'linkedNames', 'notesOf', 'pagesOf']) model[name].mockResolvedValue([]);
    model.subjects.mockResolvedValue([INFANTINO]);
    model.addVote.mockResolvedValue([{id: 1}]);
    model.addVotes.mockResolvedValue([]);
    model.sourcesSince.mockResolvedValue(0);
    model.voteById.mockResolvedValue(null);
    model.knownHashes.mockResolvedValue(new Set());
    wikidata.searchItems.mockReset();
    wikidata.describeItems.mockReset();
});

describe('the reading routes', () => {
    it('should refuse a reader who is not signed in', async () => {
        expect((await call('/map')).status).toBe(401);
        expect((await call('/associations/Q1')).status).toBe(401);
    });

    it('should answer the map in the shape of the contract: 217 members, the levels, the candidates, the position of what was read', async () => {
        model.signals.mockResolvedValue([signal]);
        const {status, body} = await call('/map', {user: 1});
        expect(status).toBe(200);
        expect(body.members).toHaveLength(217);
        expect(body.levels).toContain('soutien_declare');
        expect(body.subjects[0]).toMatchObject({qid: INFANTINO.qid, positions_known: 1, color_index: 1});
        expect(body.members.find(member => member.fifa === 'JPN').positions[INFANTINO.qid]).toMatchObject({position: 'non_soutien_declare', human: null, signals_count: 1});
    });

    it('should answer the sheet of an association, and 404 for one that does not exist', async () => {
        model.signalsOf.mockResolvedValue([signal]);
        const {status, body} = await call(`/associations/${JAPAN}`, {user: 1});
        expect(status).toBe(200);
        expect(body.member).toMatchObject({fifa: 'JPN'});
        expect(body.signals[0]).toMatchObject({certainty: 'established', sentence: expect.stringContaining('JFA'), speaker: {binds: true}});
        expect((await call('/associations/Q1', {user: 1})).status).toBe(404);
    });

    it('should answer the confederations with their number of members, and the presidents Wikidata has', async () => {
        model.leaders.mockResolvedValue([{member_qid: JAPAN, person_qid: 'Q1', name: 'A President', role: 'President', since: '2022-01-01', checked_at: new Date()}]);
        const confederations = (await call('/confederations', {user: 1})).body.confederations;
        expect(confederations.find(item => item.fifa === 'UEFA').members_count).toBe(55);
        const presidents = (await call('/presidents', {user: 1})).body.presidents;
        expect(presidents).toEqual([expect.objectContaining({member_qid: JAPAN, name: 'A President', since: '2022-01-01', articles_30d: 0, last_mention: null})]);
    });

    it('should give each president the articles of the last 30 days that name him and the latest one, asked by his item of Wikidata or by his name', async () => {
        model.leaders.mockResolvedValue([
            {member_qid: JAPAN, person_qid: 'Q1', name: 'Kozo Tashima', role: 'President', since: null, checked_at: new Date()},
            {member_qid: 'Q502018', person_qid: null, name: 'Jesper Møller', role: 'President', since: null, checked_at: new Date()}]);
        model.mentionsOfLeaders.mockResolvedValue({
            counts: [{lid: 1, articles: 12, last_at: new Date('2026-11-11T10:00:00Z')}],
            latest: [{lid: 1, medium: 'camfoot.com', link: 'https://camfoot.com/a', title: 'A title', at: new Date('2026-11-11T10:00:00Z')}]});
        const {body} = await call('/presidents', {user: reader()});
        const [first, second] = body.presidents;
        expect(model.mentionsOfLeaders.mock.calls.at(-1)[0]).toEqual([{lid: 1, qid: 'Q1', key: 'kozo tashima'}, {lid: 2, qid: null, key: 'jesper moller'}]);
        expect(first).toMatchObject({articles_30d: 12, last_mention: {at: '2026-11-11T10:00:00.000Z', medium: 'camfoot.com', url: 'https://camfoot.com/a', title: 'A title'}});
        expect(second).toMatchObject({articles_30d: 0, last_mention: null});
    });
});

describe('the news of the president of an association', () => {
    const LEADER = {member_qid: JAPAN, person_qid: 'Q33208412', name: 'Philippe Diallo', role: 'President', since: '2021-06-01', checked_at: new Date()};
    const news = (id, at, relevant = true) => ({id, title: `Title ${id}`, description: `  A description \n of ${id}  `, lang: 'fr', medium: 'lequipe.fr', link: `https://lequipe.fr/a${id}`, at: new Date(at), relevant});
    const page = (rows, more = {}) => ({total: 126, total_all: 145, total_football: 126, rows, ...more});

    it('should give the news of the last 30 days that name the president, newest first, with the total and the page asked', async () => {
        model.leaders.mockResolvedValue([LEADER]);
        model.newsOfLeader.mockResolvedValue(page([news(2, '2026-11-12T10:00:00Z'), news(1, '2026-11-11T10:00:00Z')]));
        const {status, body} = await call(`/associations/${JAPAN}/leader/news?limit=2&offset=40`, {user: 1});
        expect(status).toBe(200);
        expect(model.newsOfLeader).toHaveBeenCalledWith({qid: 'Q33208412', key: 'philippe diallo', orgs: [JAPAN, expect.stringMatching(/^Q\d+$/), 'Q253414'], scope: 'football', limit: 2, offset: 40});
        expect(body).toEqual({leader: {name: 'Philippe Diallo', person_qid: 'Q33208412'}, scope: 'football', total: 126, total_all: 145, total_football: 126, limit: 2, offset: 40, articles: [
            {id: 2, title: 'Title 2', description: 'A description of 2', medium: 'lequipe.fr', url: 'https://lequipe.fr/a2', lang: 'fr', published_at: '2026-11-12T10:00:00.000Z', relevant: true},
            {id: 1, title: 'Title 1', description: 'A description of 1', medium: 'lequipe.fr', url: 'https://lequipe.fr/a1', lang: 'fr', published_at: '2026-11-11T10:00:00.000Z', relevant: true},
        ]});
    });

    it('should keep only the football news by default and every news with scope=all, telling both totals so that the page says what the filter hides', async () => {
        model.leaders.mockResolvedValue([LEADER]);
        model.newsOfLeader.mockResolvedValue(page([news(3, '2026-11-12T10:00:00Z', false), news(2, '2026-11-11T10:00:00Z')], {total: 145}));
        const all = (await call(`/associations/${JAPAN}/leader/news?scope=all`, {user: 1})).body;
        expect(model.newsOfLeader).toHaveBeenLastCalledWith(expect.objectContaining({scope: 'all'}));
        expect(all).toMatchObject({scope: 'all', total: 145, total_all: 145, total_football: 126});
        expect(all.articles.map(one => one.relevant)).toEqual([false, true]);
        await call(`/associations/${JAPAN}/leader/news`, {user: 1});
        expect(model.newsOfLeader).toHaveBeenLastCalledWith(expect.objectContaining({scope: 'football'}));
        expect((await call(`/associations/${JAPAN}/leader/news?scope=fifa`, {user: 1})).status).toBe(422);
    });

    it('should look for a president with no item of Wikidata by his name, take 50 by default and at most 100, and never a page before the first', async () => {
        model.leaders.mockResolvedValue([{...LEADER, person_qid: null}]);
        model.newsOfLeader.mockResolvedValue(page([], {total: 0, total_all: 0, total_football: 0}));
        const last = () => model.newsOfLeader.mock.calls.at(-1)[0];
        await call(`/associations/${JAPAN}/leader/news`, {user: 1});
        expect(last()).toMatchObject({qid: null, key: 'philippe diallo', limit: 50, offset: 0});
        await call(`/associations/${JAPAN}/leader/news?limit=5000&offset=-3`, {user: 1});
        expect(last()).toMatchObject({qid: null, limit: 100, offset: 0});
        await call(`/associations/${JAPAN}/leader/news?limit=abc&offset=x`, {user: 1});
        expect(last()).toMatchObject({qid: null, limit: 50, offset: 0});
    });

    it('should answer an empty list for an association with no president, 404 for one that does not exist, and 401 for a reader who is not signed in', async () => {
        model.leaders.mockResolvedValue([]);
        const {status, body} = await call(`/associations/${JAPAN}/leader/news`, {user: 1});
        expect(status).toBe(200);
        expect(body).toEqual({leader: null, scope: 'football', total: 0, total_all: 0, total_football: 0, limit: 50, offset: 0, articles: []});
        expect(model.newsOfLeader).not.toHaveBeenCalled();
        expect((await call('/associations/Q1/leader/news', {user: 1})).status).toBe(404);
        expect((await call(`/associations/${JAPAN}/leader/news`)).status).toBe(401);
    });
});

describe('the votes', () => {
    it('should record the vote of the signed-in reader and answer the vote that decides', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([{user_id: user, username: `reader${user}`, subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'for', note: '', created_at: new Date()}]);
        const {status, body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', note: ' It said so '}});
        expect(status).toBe(200);
        expect(model.addVote).toHaveBeenCalledWith({userId: user, subjectQid: INFANTINO.qid, memberQid: JAPAN, value: 'for', note: 'It said so', seen: '', source: null});
        expect(body).toMatchObject({ok: true, human: {value: 'for', by: `reader${user}`, newer_evidence: false}});
    });

    it('should answer no decisive vote when the only one was taken back', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([{user_id: user, username: 'x', value: 'for', created_at: new Date(Date.now() - 1000)}, {user_id: user, username: 'x', value: 'withdraw', created_at: new Date()}]);
        const {body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'withdraw'}});
        expect(body).toEqual({ok: true, human: null, confirmed: null});
    });

    it('should record a confirmation with the position the reader saw, keep the position as it is, and answer who confirmed it', async () => {
        const user = reader();
        model.signalsOf.mockResolvedValue([signal]);
        model.votesOfPair.mockResolvedValueOnce([]).mockResolvedValue([{user_id: user, username: `reader${user}`, subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'confirm', note: '', seen: 'non_soutien_declare', created_at: new Date()}]);
        const {status, body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'confirm'}});
        expect(status).toBe(200);
        expect(model.addVote).toHaveBeenCalledWith(expect.objectContaining({userId: user, value: 'confirm', seen: 'non_soutien_declare'}));
        expect(body).toMatchObject({ok: true, human: null, confirmed: {count: 1, by: [`reader${user}`], outdated: 0}});
    });

    it('should record the position of the NEWS a second reader confirms, not the solid colour the first confirmation gave it, and answer it as validated', async () => {
        const user = reader();
        const probable = {...signal, stance: 'for', level: 'probable'};
        model.signalsOf.mockResolvedValue([probable]);
        const first = {user_id: 1, username: 'reader1', subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'confirm', note: '', seen: 'soutien_probable', created_at: new Date(Date.now() - 5000)};
        model.votesOfPair.mockResolvedValueOnce([first]).mockResolvedValue([first, {user_id: user, username: `reader${user}`, subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'confirm', note: '', seen: 'soutien_probable', created_at: new Date()}]);
        const {body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'confirm'}});
        expect(model.addVote).toHaveBeenCalledWith(expect.objectContaining({value: 'confirm', seen: 'soutien_probable'}));
        expect(body.confirmed).toMatchObject({count: 2, outdated: 0});
        // the map draws it solid, the news kept as ai_position
        model.signals.mockResolvedValue([probable]);
        model.votes.mockResolvedValue([{...first, id: 1}]);
        const map = (await call('/map', {user: reader()})).body;
        expect(map.members.find(member => member.fifa === 'JPN').positions[INFANTINO.qid]).toMatchObject({position: 'soutien_declare', ai_position: 'soutien_probable', human: null});
    });

    it('should record the confirmation of "no position" when the news say nothing', async () => {
        const user = reader();
        model.signalsOf.mockResolvedValue([]);
        model.votesOfPair.mockResolvedValue([]);
        await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'confirm'}});
        expect(model.addVote).toHaveBeenCalledWith(expect.objectContaining({value: 'confirm', seen: 'inconnue'}));
    });

    it('should refuse what is not a vote: a word, an association or a candidate that does not exist', async () => {
        const user = reader();
        const post = (body) => call('/votes', {method: 'POST', user, body});
        expect((await post({subject: INFANTINO.qid, member: JAPAN, value: 'maybe'})).status).toBe(422);
        expect((await post({subject: INFANTINO.qid, member: 'Q1', value: 'for'})).status).toBe(422);
        expect((await post({subject: 'Q5', member: JAPAN, value: 'for'})).status).toBe(422);
        expect(model.addVote).not.toHaveBeenCalled();
    });

    it('should stop a reader at 30 votes in ten minutes with a 429, the others not counted', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([]);
        let last;
        for (let i = 0; i < 31; i++) last = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'for'}});
        expect(last.status).toBe(429);
        expect((await call('/votes', {method: 'POST', user: reader(), body: {subject: INFANTINO.qid, member: JAPAN, value: 'for'}})).status).toBe(200);
    });

    it('should let only an administrator take a vote off', async () => {
        expect((await call('/votes/5', {method: 'DELETE', user: reader()})).status).toBe(403);
        expect((await call('/votes/5', {method: 'DELETE', user: reader(), admin: true})).status).toBe(204);
        expect(model.deleteVote).toHaveBeenCalledWith(5);
    });
});

describe('the choice of the candidate an association leans toward', () => {
    const WENGER = {...INFANTINO, qid: 'Q215244', name: 'Arsene Wenger', terms: ['wenger'], status: 'declared', color_index: 2};
    const supports = {...signal, stance: 'for', level: 'declared'};
    const vote = (user, subject, value, at = new Date()) => ({user_id: user, username: `reader${user}`, subject_qid: subject, member_qid: JAPAN, value, note: '', seen: '', created_at: at});
    const lean = (user, body) => call('/leans', {method: 'POST', user, body: {member: JAPAN, ...body}});
    beforeEach(() => {
        model.subjects.mockResolvedValue([INFANTINO, WENGER]);
        model.signalsOf.mockResolvedValue([supports]);
    });

    it('should set the association FOR the chosen candidate and "no position" for the one the news show it supporting, in one write', async () => {
        const user = reader();
        model.votesOf.mockResolvedValueOnce([]).mockResolvedValue([vote(user, INFANTINO.qid, 'unknown'), vote(user, WENGER.qid, 'for')]);
        const {status, body} = await lean(user, {subject: WENGER.qid});
        expect(status).toBe(200);
        expect(model.addVotes).toHaveBeenCalledTimes(1);
        expect(model.addVotes).toHaveBeenCalledWith(user, [{subjectQid: INFANTINO.qid, memberQid: JAPAN, value: 'unknown'}, {subjectQid: WENGER.qid, memberQid: JAPAN, value: 'for', note: '', source: null}]);
        expect(body.lean).toEqual({subject_qid: WENGER.qid, source: 'reader', conflicting: []});
        expect(body.positions[WENGER.qid]).toMatchObject({position: 'soutien_declare', human: {value: 'for', by: `reader${user}`}});
        expect(body.positions[INFANTINO.qid]).toMatchObject({position: 'inconnue', ai_position: 'soutien_declare', human: {value: 'unknown'}});
    });

    it('should leave the association with no candidate when the reader says it leans toward none, touching only what shows support', async () => {
        const user = reader();
        model.votesOf.mockResolvedValue([]);
        await lean(user, {subject: 'none'});
        expect(model.addVotes).toHaveBeenCalledWith(user, [{subjectQid: INFANTINO.qid, memberQid: JAPAN, value: 'unknown'}]);
    });

    it('should never touch the opposition: a candidate the association is against stays as it is', async () => {
        const user = reader();
        model.signalsOf.mockResolvedValue([{...signal, stance: 'against', level: 'declared'}]);
        model.votesOf.mockResolvedValue([]);
        await lean(user, {subject: WENGER.qid});
        expect(model.addVotes).toHaveBeenCalledWith(user, [{subjectQid: WENGER.qid, memberQid: JAPAN, value: 'for', note: '', source: null}]);
    });

    it('should write nothing when the reader makes the choice that already stands', async () => {
        const user = reader();
        model.votesOf.mockResolvedValue([vote(user, INFANTINO.qid, 'unknown'), vote(user, WENGER.qid, 'for')]);
        const {body} = await lean(user, {subject: WENGER.qid});
        expect(model.addVotes).toHaveBeenCalledWith(user, []);
        expect(body.written).toBe(0);
    });

    it('should take the choice of the reader back on every candidate they decided on', async () => {
        const user = reader();
        model.votesOf.mockResolvedValue([vote(user, INFANTINO.qid, 'unknown'), vote(user, WENGER.qid, 'for')]);
        await lean(user, {subject: 'withdraw'});
        expect(model.addVotes).toHaveBeenCalledWith(user, [{subjectQid: INFANTINO.qid, memberQid: JAPAN, value: 'withdraw'}, {subjectQid: WENGER.qid, memberQid: JAPAN, value: 'withdraw'}]);
    });

    it('should refuse an association or a candidate that does not exist, and a word that is none', async () => {
        const user = reader();
        expect((await call('/leans', {method: 'POST', user, body: {member: 'Q1', subject: WENGER.qid}})).status).toBe(422);
        expect((await lean(user, {subject: 'Q5'})).status).toBe(422);
        expect((await lean(user, {subject: 'maybe'})).status).toBe(422);
        expect((await call('/leans', {method: 'POST', body: {member: JAPAN, subject: 'none'}})).status).toBe(401);
        expect(model.addVotes).not.toHaveBeenCalled();
    });

    it('should carry the candidate each association leans toward in the map', async () => {
        model.signals.mockResolvedValue([supports]);
        const row = (await call('/map', {user: reader()})).body.members.find(member => member.fifa === 'JPN');
        expect(row.lean).toEqual({subject_qid: INFANTINO.qid, source: 'news', conflicting: []});
    });
});

describe('the source a reader joins to a choice', () => {
    const PAGE = 'https://www.example.com/news/jfa-backs-infantino?utm=1#top';
    const CLEAN = 'https://www.example.com/news/jfa-backs-infantino?utm=1';
    const WENGER = {...INFANTINO, qid: 'Q215244', name: 'Arsene Wenger', terms: ['wenger'], status: 'declared', color_index: 2};
    const withSource = {user_id: 7, username: 'reader7', subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'for', note: 'See paragraph 3', seen: '', created_at: new Date(),
        source_url: CLEAN, source_medium: 'example.com', source_check: 'pending', source_found: '', source_checked_at: null};

    it('should keep the source of a vote for or against (the address cleaned, the medium named), start its check and answer it pending', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([{...withSource, user_id: user, username: `reader${user}`}]);
        const {status, body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', source: {url: PAGE}}});
        expect(status).toBe(200);
        expect(model.addVote).toHaveBeenCalledWith(expect.objectContaining({value: 'for', source: {url: CLEAN, medium: 'example.com'}}));
        expect(body.human).toMatchObject({value: 'for', source: {url: CLEAN, medium: 'example.com', check: 'pending', found: '', checked_at: null}});
    });

    it('should accept the address as a plain string, and refuse what is no address, a password in it, another scheme, and a source with a confirmation or no position', async () => {
        const user = reader();
        const post = (body) => call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', ...body}});
        expect((await post({source: PAGE})).status).toBe(200);
        for (const source of ['not an address', 'ftp://example.com/a', 'https://name:secret@example.com/a', {url: 'https://example.com/' + 'a'.repeat(500)}]) {
            const answer = await post({source});
            expect([source, answer.status]).toEqual([source, 422]);
        }
        expect((await post({value: 'confirm', source: PAGE})).status).toBe(422);
        expect((await post({value: 'unknown', source: PAGE})).status).toBe(422);
        expect(model.addVote).toHaveBeenCalledTimes(1);
    });

    it('should refuse an address of the network of the server with the answer of the check of public addresses', async () => {
        const {assertPublicUrl} = await import('../../services/utils/public-url.js');
        assertPublicUrl.mockRejectedValueOnce(Object.assign(new Error('"intranet" is a private address, it can\'t be used.'), {status: 400}));
        const answer = await call('/votes', {method: 'POST', user: reader(), body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', source: 'http://intranet/a'}});
        expect(answer.status).toBe(400);
        expect(model.addVote).not.toHaveBeenCalled();
    });

    it('should stop a reader at their sources of the day with a 429, and write nothing', async () => {
        model.sourcesSince.mockResolvedValue(20);
        const answer = await call('/votes', {method: 'POST', user: reader(), body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', source: PAGE}});
        expect(answer.status).toBe(429);
        expect(model.addVote).not.toHaveBeenCalled();
    });

    it('should join the source to the vote FOR the chosen candidate only, with the word of the reader, and write again a choice that stands when the page is another', async () => {
        const user = reader();
        model.subjects.mockResolvedValue([INFANTINO, WENGER]);
        model.signalsOf.mockResolvedValue([]);
        model.votesOf.mockResolvedValue([]);
        model.addVotes.mockResolvedValue([[{id: 11}]]);
        const post = (subject, more = {}) => call('/leans', {method: 'POST', user, body: {member: JAPAN, subject, ...more}});
        await post(WENGER.qid, {source: {url: PAGE}, note: ' The president said it '});
        expect(model.addVotes).toHaveBeenLastCalledWith(user, [{subjectQid: WENGER.qid, memberQid: JAPAN, value: 'for', note: 'The president said it', source: {url: CLEAN, medium: 'example.com'}}]);
        // the choice stands with that page: nothing to write; with another page: written again
        model.votesOf.mockResolvedValue([{user_id: user, username: 'x', subject_qid: WENGER.qid, member_qid: JAPAN, value: 'for', note: '', created_at: new Date(), source_url: CLEAN}]);
        await post(WENGER.qid, {source: PAGE});
        expect(model.addVotes).toHaveBeenLastCalledWith(user, []);
        await post(WENGER.qid, {source: 'https://other.example.org/b'});
        expect(model.addVotes).toHaveBeenLastCalledWith(user, [expect.objectContaining({value: 'for', source: {url: 'https://other.example.org/b', medium: 'example.org'}})]);
        // a source has no meaning with "none" or "withdraw"
        expect((await post('none', {source: PAGE})).status).toBe(422);
        expect((await post('withdraw', {source: PAGE})).status).toBe(422);
    });

    it('should list on the sheet the sources the choices stand on, each with what the AI read, and none of a vote taken back', async () => {
        const read = {...withSource, id: 3, source_check: 'says', source_found: 'The JFA will back Infantino.', source_checked_at: new Date('2026-11-12T12:00:00Z')};
        model.votesOf.mockResolvedValue([read, {...withSource, id: 4, user_id: 8, username: 'reader8', created_at: new Date(Date.now() - 5000), source_url: 'https://other.example.org/b'},
            {user_id: 8, username: 'reader8', subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'withdraw', note: '', created_at: new Date()}]);
        const sheet = (await call(`/associations/${JAPAN}`, {user: reader()})).body;
        expect(sheet.sources).toEqual([expect.objectContaining({subject_qid: INFANTINO.qid, value: 'for', by: 'reader7', url: CLEAN, medium: 'example.com', check: 'says', found: 'The JFA will back Infantino.',
            checked_at: '2026-11-12T12:00:00.000Z', note: 'See paragraph 3'})]);
        expect(sheet.votes.find(one => one.by === 'reader7').source).toMatchObject({check: 'says'});
    });
});

describe('the source a reader adds on its own, with no candidate', () => {
    const PAGE = 'https://www.example.com/news/jfa-and-the-race?utm=1#top';
    const CLEAN = 'https://www.example.com/news/jfa-and-the-race?utm=1';
    const row = (more = {}) => ({id: 31, user_id: 9, username: 'reader9', member_qid: JAPAN, url: CLEAN, medium: 'example.com', note: '', state: 'pending', readings: [], checked_at: null, created_at: new Date('2026-11-13T09:00:00Z'), ...more});

    it('should keep a page added on its own with no candidate, answer it pending and as the reader\'s own, and start no vote', async () => {
        model.addSource.mockResolvedValue(row({note: 'Interview of the president'}));
        const {status, body} = await call('/sources', {method: 'POST', user: 9, body: {member: JAPAN, source: {url: PAGE}, note: ' Interview of the president '}});
        expect(status).toBe(201);
        expect(model.addSource).toHaveBeenCalledWith({userId: 9, memberQid: JAPAN, url: CLEAN, medium: 'example.com', note: 'Interview of the president'});
        expect(body.source).toMatchObject({id: 31, kind: 'page', subject_qid: null, value: null, by: 'reader9', url: CLEAN, medium: 'example.com', check: 'pending', found: '', readings: [], mine: true});
        expect(model.addVote).not.toHaveBeenCalled();
        expect(model.addVotes).not.toHaveBeenCalled();
    });

    it('should accept the address as a plain string, and refuse a missing one, a bad one, an association that does not exist, and a reader who is not signed in', async () => {
        model.addSource.mockResolvedValue(row());
        const post = (body, user = reader()) => call('/sources', {method: 'POST', user, body});
        expect((await post({member: JAPAN, source: PAGE})).status).toBe(201);
        for (const source of [undefined, '', 'not an address', 'ftp://example.com/a', 'https://name:secret@example.com/a']) {
            const answer = await post({member: JAPAN, source});
            expect([source, answer.status]).toEqual([source, 422]);
        }
        expect((await post({member: 'Q1', source: PAGE})).status).toBe(422);
        expect((await call('/sources', {method: 'POST', body: {member: JAPAN, source: PAGE}})).status).toBe(401);
        expect(model.addSource).toHaveBeenCalledTimes(1);
    });

    it('should refuse a private address, and stop a reader at their sources of the day, the ones joined to a choice counted too', async () => {
        const {assertPublicUrl} = await import('../../services/utils/public-url.js');
        assertPublicUrl.mockRejectedValueOnce(Object.assign(new Error('"intranet" is a private address, it can\'t be used.'), {status: 400}));
        expect((await call('/sources', {method: 'POST', user: reader(), body: {member: JAPAN, source: 'http://intranet/a'}})).status).toBe(400);
        model.sourcesSince.mockResolvedValue(20);
        expect((await call('/sources', {method: 'POST', user: reader(), body: {member: JAPAN, source: PAGE}})).status).toBe(429);
        expect(model.addSource).not.toHaveBeenCalled();
    });

    it('should let the author or an administrator take a source added on its own off, and nobody else', async () => {
        model.sourceById.mockResolvedValue({id: 31, user_id: 9, member_qid: JAPAN, url: CLEAN, state: 'says'});
        expect((await call('/sources/31', {method: 'DELETE', user: 10})).status).toBe(403);
        expect(model.deletePage).not.toHaveBeenCalled();
        expect((await call('/sources/31', {method: 'DELETE', user: 9})).status).toBe(204);
        expect((await call('/sources/31', {method: 'DELETE', user: 1000})).status).toBe(204);
        expect(model.deletePage).toHaveBeenCalledTimes(2);
        model.sourceById.mockResolvedValue(null);
        expect((await call('/sources/32', {method: 'DELETE', user: 9})).status).toBe(404);
    });

    it('should tell on the sheet which signals come from a page a reader added, and who added it', async () => {
        model.signalsOf.mockResolvedValue([{...signal, id: 7, source_id: 31, added_by: 'reader9'}, signal]);
        const sheet = (await call(`/associations/${JAPAN}`, {user: 9})).body;
        expect(sheet.signals.find(one => one.id === 7)).toMatchObject({source_id: 31, added_by: 'reader9'});
        expect(sheet.signals.find(one => one.id === 1)).toMatchObject({source_id: null, added_by: null});
    });

    it('should list on the sheet the sources added on their own with the ones of the choices, newest first, with the candidate the page speaks of when it does', async () => {
        const choice = {user_id: 7, username: 'reader7', subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'for', note: '', seen: '', created_at: new Date('2026-11-12T10:00:00Z'),
            source_url: 'https://other.example.org/b', source_medium: 'example.org', source_check: 'says', source_found: 'The JFA backs him.', source_checked_at: new Date('2026-11-12T10:01:00Z')};
        model.votesOf.mockResolvedValue([choice]);
        model.pagesOf.mockResolvedValue([row({state: 'says', checked_at: new Date('2026-11-13T09:01:00Z'),
            readings: [{subject_qid: INFANTINO.qid, stance: 'against', level: 'declared', found: 'The JFA will not back Infantino.'}]}), row({id: 30, user_id: 8, username: 'reader8', created_at: new Date('2026-11-11T09:00:00Z'), url: 'https://x.example.net/c', state: 'unclear'})]);
        const sheet = (await call(`/associations/${JAPAN}`, {user: 9})).body;
        expect(sheet.sources.map(one => [one.kind, one.url])).toEqual([['page', CLEAN], ['choice', 'https://other.example.org/b'], ['page', 'https://x.example.net/c']]);
        expect(sheet.sources[0]).toMatchObject({id: 31, subject_qid: INFANTINO.qid, value: 'against', check: 'says', found: 'The JFA will not back Infantino.', checked_at: '2026-11-13T09:01:00.000Z', mine: true,
            readings: [expect.objectContaining({subject_qid: INFANTINO.qid, stance: 'against', level: 'declared'})]});
        expect(sheet.sources[2]).toMatchObject({subject_qid: null, value: null, check: 'unclear', mine: false});
    });
});

describe('the notes on an association', () => {
    const row = (id, userId, text, at) => ({id, user_id: userId, username: `reader${userId}`, text, created_at: new Date(at)});

    it('should carry the notes on the sheet, newest first as the model gives them, each told mine to the reader who wrote it', async () => {
        model.notesOf.mockResolvedValue([row(2, 7, 'Second', '2026-11-12T10:00:00Z'), row(1, 8, 'First', '2026-11-11T10:00:00Z')]);
        const sheet = (await call(`/associations/${JAPAN}`, {user: 7})).body;
        expect(sheet.notes).toEqual([{id: 2, by: 'reader7', at: '2026-11-12T10:00:00.000Z', text: 'Second', mine: true}, {id: 1, by: 'reader8', at: '2026-11-11T10:00:00.000Z', text: 'First', mine: false}]);
        expect(model.notesOf).toHaveBeenCalledWith(JAPAN);
    });

    it('should let any reader add a note, trimmed, and answer it as theirs with a 201', async () => {
        model.addNote.mockResolvedValue(row(5, 9, 'The president spoke on TV', '2026-11-12T11:00:00Z'));
        const {status, body} = await call('/notes', {method: 'POST', user: 9, body: {member: JAPAN, text: '  The president spoke on TV  '}});
        expect(status).toBe(201);
        expect(model.addNote).toHaveBeenCalledWith({userId: 9, memberQid: JAPAN, text: 'The president spoke on TV'});
        expect(body).toEqual({note: {id: 5, by: 'reader9', at: '2026-11-12T11:00:00.000Z', text: 'The president spoke on TV', mine: true}});
    });

    it('should refuse an empty note, one over 500 characters, an association that does not exist, and a reader who is not signed in', async () => {
        const post = (body, user = reader()) => call('/notes', {method: 'POST', user, body});
        expect((await post({member: JAPAN, text: '   '})).status).toBe(422);
        expect((await post({member: JAPAN, text: 'a'.repeat(501)})).status).toBe(422);
        expect((await post({member: 'Q1', text: 'ok'})).status).toBe(422);
        expect((await post({member: JAPAN})).status).toBe(422);
        expect((await call('/notes', {method: 'POST', body: {member: JAPAN, text: 'ok'}})).status).toBe(401);
        expect(model.addNote).not.toHaveBeenCalled();
    });

    it('should stop a reader at ten notes an hour with a 429', async () => {
        const user = reader();
        model.addNote.mockResolvedValue(row(1, user, 'x', '2026-11-12T11:00:00Z'));
        let last;
        for (let i = 0; i < 11; i++) last = await call('/notes', {method: 'POST', user, body: {member: JAPAN, text: 'x'}});
        expect(last.status).toBe(429);
    });

    it('should let the author or an administrator take a note off, and nobody else', async () => {
        model.noteById.mockResolvedValue({id: 5, user_id: 9});
        expect((await call('/notes/5', {method: 'DELETE', user: 10})).status).toBe(403);
        expect(model.deleteNote).not.toHaveBeenCalled();
        expect((await call('/notes/5', {method: 'DELETE', user: 9})).status).toBe(204);
        expect((await call('/notes/5', {method: 'DELETE', user: 1000})).status).toBe(204);
        expect(model.deleteNote).toHaveBeenCalledTimes(2);
        model.noteById.mockResolvedValue(null);
        expect((await call('/notes/6', {method: 'DELETE', user: 9})).status).toBe(404);
    });
});

describe('the audits', () => {
    it('should let only an administrator read the last audits of the positions shown', async () => {
        model.audits.mockResolvedValue([{id: 1, made_at: new Date('2026-11-12T10:00:00Z'), auditor: 'gpt-oss:120b', sampled: 30, agreed: 27, unreadable: 0, votes_total: 2, votes_contradicting: 1, verdict: 'ok', details: {}}]);
        expect((await call('/audits', {user: reader()})).status).toBe(403);
        const {status, body} = await call('/audits', {user: reader(), admin: true});
        expect(status).toBe(200);
        expect(body.audits[0]).toMatchObject({made_at: '2026-11-12T10:00:00.000Z', sampled: 30, agreed: 27, verdict: 'ok'});
    });
});

describe('the candidates', () => {
    const WENGER = {qid: 'Q215244', label: 'Arsène Wenger', description: 'French football manager', human: true};

    it('should let a reader add a person with no validation, from the last word of the name, and read the news', async () => {
        const user = reader();
        wikidata.describeItems.mockResolvedValue([WENGER]);
        model.addSubject.mockResolvedValue([{qid: WENGER.qid, name: WENGER.label, terms: ['wenger'], status: 'declared', state: 'computing', color_index: 2}]);
        const {status, body} = await call('/subjects', {method: 'POST', user, body: {qid: WENGER.qid}});
        expect(status).toBe(201);
        expect(body).toMatchObject({already: false, subject: {qid: WENGER.qid, state: 'computing'}});
        expect(model.addSubject).toHaveBeenCalledWith({qid: WENGER.qid, name: 'Arsène Wenger', terms: ['wenger'], status: 'declared', userId: user, origin: 'reader', found: null});
    });

    it('should answer 200 already for a candidate that is on the map, and add nothing', async () => {
        const {status, body} = await call('/subjects', {method: 'POST', user: reader(), body: {qid: INFANTINO.qid}});
        expect(status).toBe(200);
        expect(body).toMatchObject({already: true, subject: {qid: INFANTINO.qid}});
        expect(model.addSubject).not.toHaveBeenCalled();
    });

    it('should refuse what is not a person, a qid that is none, and "incumbent"', async () => {
        wikidata.describeItems.mockResolvedValue([{qid: 'Q1', label: 'Universe', human: false}]);
        expect((await call('/subjects', {method: 'POST', user: reader(), body: {qid: 'Q1'}})).status).toBe(422);
        expect((await call('/subjects', {method: 'POST', user: reader(), body: {qid: 'not a qid'}})).status).toBe(422);
        expect((await call('/subjects', {method: 'POST', user: reader(), body: {qid: WENGER.qid, status: 'incumbent'}})).status).toBe(422);
        expect(model.addSubject).not.toHaveBeenCalled();
    });

    it('should make room by itself when the map is full: the oldest candidate marked withdrawn goes; none withdrawn, a 409', async () => {
        const full = (status) => Array.from({length: 6}, (_, i) => ({...INFANTINO, qid: `Q${200 + i}`, color_index: i + 1, created_at: `2026-10-0${i + 1}T00:00:00Z`, status: i === 3 || i === 1 ? status : 'declared'}));
        wikidata.describeItems.mockResolvedValue([WENGER]);
        model.addSubject.mockResolvedValue([{qid: WENGER.qid, name: WENGER.label, terms: ['wenger'], status: 'declared', state: 'computing', color_index: 2}]);
        model.subjects.mockResolvedValue(full('declared'));
        const refused = await call('/subjects', {method: 'POST', user: reader(), body: {qid: WENGER.qid}});
        expect(refused.status).toBe(409);
        expect(refused.body.error).toContain('withdrawn');
        model.subjects.mockResolvedValue(full('withdrawn'));
        const made = await call('/subjects', {method: 'POST', user: reader(), body: {qid: WENGER.qid}});
        expect(made.status).toBe(201);
        expect(model.deleteSubject).toHaveBeenCalledWith('Q201');
    });

    it('should stop a reader at three candidates a day', async () => {
        const user = reader();
        wikidata.describeItems.mockResolvedValue([WENGER]);
        model.addSubject.mockResolvedValue([{qid: WENGER.qid, name: WENGER.label, terms: ['wenger'], status: 'declared', state: 'computing', color_index: 2}]);
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await call('/subjects', {method: 'POST', user, body: {qid: WENGER.qid}})).status);
        expect(statuses).toEqual([201, 201, 201, 429]);
    });

    it('should search the persons only: the items of Wikidata that are no human are left out', async () => {
        wikidata.searchItems.mockResolvedValue([{qid: 'Q215244', label: 'Arsène Wenger', description: 'French football manager'}, {qid: 'Q9', label: 'Wenger (company)', description: 'knife maker'}]);
        wikidata.describeItems.mockResolvedValue([{qid: 'Q215244', label: 'Arsène Wenger', human: true}, {qid: 'Q9', label: 'Wenger', human: false}]);
        const {status, body} = await call('/people?q=wenger', {user: reader()});
        expect(status).toBe(200);
        expect(body.people).toEqual([{qid: 'Q215244', name: 'Arsène Wenger', description: 'French football manager'}]);
        expect((await call('/people?q=w', {user: reader()})).status).toBe(422);
    });

    it('should let any reader change the status of a candidate', async () => {
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'PATCH', user: reader(), body: {status: 'withdrawn'}})).status).toBe(204);
        expect(model.setSubjectStatus).toHaveBeenCalledWith(INFANTINO.qid, 'withdrawn');
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'PATCH', user: reader(), body: {status: 'elected'}})).status).toBe(422);
    });

    describe('taking a candidate off the map', () => {
        const FOUND = {...INFANTINO, qid: 'Q215244', name: 'Arsene Wenger', status: 'rumoured', origin: 'news', color_index: 2};
        beforeEach(() => model.subjects.mockResolvedValue([INFANTINO, FOUND]));

        it('should let any reader take a candidate off, with no validation, and have the news never bring him back', async () => {
            expect((await call(`/subjects/${FOUND.qid}`, {method: 'DELETE', user: reader()})).status).toBe(204);
            expect(model.deleteSubject).toHaveBeenCalledWith(FOUND.qid);
            expect(model.dismiss).toHaveBeenCalledWith(FOUND.qid);
            // one a reader added is taken off the same way
            model.subjects.mockResolvedValue([INFANTINO, {...FOUND, origin: 'reader'}]);
            expect((await call(`/subjects/${FOUND.qid}`, {method: 'DELETE', user: reader()})).status).toBe(204);
        });

        it('should keep the president in office: a reader is refused (even after marking him withdrawn), an administrator may', async () => {
            expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'DELETE', user: reader()})).status).toBe(403);
            model.subjects.mockResolvedValue([{...INFANTINO, status: 'withdrawn', origin: 'seed'}]);
            expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'DELETE', user: reader()})).status).toBe(403);
            expect(model.deleteSubject).not.toHaveBeenCalled();
            expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'DELETE', user: 1000})).status).toBe(204);
            expect(model.deleteSubject).toHaveBeenCalledWith(INFANTINO.qid);
            expect(model.dismiss).toHaveBeenCalledWith(INFANTINO.qid);
        });

        it('should answer 404 for a candidate that is not on the map, 401 for a reader who is not signed in, and stop a reader at ten an hour', async () => {
            expect((await call('/subjects/Q5', {method: 'DELETE', user: reader()})).status).toBe(404);
            expect((await call(`/subjects/${FOUND.qid}`, {method: 'DELETE'})).status).toBe(401);
            const user = reader();
            let last;
            for (let i = 0; i < 11; i++) last = await call(`/subjects/${FOUND.qid}`, {method: 'DELETE', user});
            expect(last.status).toBe(429);
        });
    });
});
