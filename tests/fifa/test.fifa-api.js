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
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';

const model = Object.fromEntries(['subjects', 'addSubject', 'markChecked', 'setSubjectStatus', 'deleteSubject', 'news', 'linkedNames', 'mentionNames', 'knownHashes', 'insertSignal',
    'unconfirmed', 'updateSignal', 'signals', 'signalsOf', 'votes', 'votesOf', 'votesOfPair', 'addVote', 'deleteVote', 'leaders', 'replaceLeaders', 'audits', 'auditSample', 'lastAudit', 'addAudit'].map(name => [name, jest.fn()]));
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
jest.unstable_mockModule('../../services/utils/admin.js', () => ({adminOnly: (refused) => (req, res, next) => req.headers['x-admin'] === '1' ? next() : res.status(403).json({error: refused})}));
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
    for (const name of ['subjects', 'signals', 'signalsOf', 'votes', 'votesOf', 'votesOfPair', 'leaders', 'news', 'unconfirmed', 'mentionNames', 'linkedNames']) model[name].mockResolvedValue([]);
    model.subjects.mockResolvedValue([INFANTINO]);
    model.addVote.mockResolvedValue(1);
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
        expect(presidents).toEqual([expect.objectContaining({member_qid: JAPAN, name: 'A President', since: '2022-01-01'})]);
    });
});

describe('the votes', () => {
    it('should record the vote of the signed-in reader and answer the vote that decides', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([{user_id: user, username: `reader${user}`, subject_qid: INFANTINO.qid, member_qid: JAPAN, value: 'for', note: '', created_at: new Date()}]);
        const {status, body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'for', note: ' It said so '}});
        expect(status).toBe(200);
        expect(model.addVote).toHaveBeenCalledWith({userId: user, subjectQid: INFANTINO.qid, memberQid: JAPAN, value: 'for', note: 'It said so'});
        expect(body).toMatchObject({ok: true, human: {value: 'for', by: `reader${user}`, newer_evidence: false}});
    });

    it('should answer no decisive vote when the only one was taken back', async () => {
        const user = reader();
        model.votesOfPair.mockResolvedValue([{user_id: user, username: 'x', value: 'for', created_at: new Date(Date.now() - 1000)}, {user_id: user, username: 'x', value: 'withdraw', created_at: new Date()}]);
        const {body} = await call('/votes', {method: 'POST', user, body: {subject: INFANTINO.qid, member: JAPAN, value: 'withdraw'}});
        expect(body).toEqual({ok: true, human: null});
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
        expect(model.addSubject).toHaveBeenCalledWith({qid: WENGER.qid, name: 'Arsène Wenger', terms: ['wenger'], status: 'declared', userId: user});
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

    it('should let any reader change the status of a candidate and only an administrator remove one', async () => {
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'PATCH', user: reader(), body: {status: 'withdrawn'}})).status).toBe(204);
        expect(model.setSubjectStatus).toHaveBeenCalledWith(INFANTINO.qid, 'withdrawn');
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'PATCH', user: reader(), body: {status: 'elected'}})).status).toBe(422);
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'DELETE', user: reader()})).status).toBe(403);
        expect((await call(`/subjects/${INFANTINO.qid}`, {method: 'DELETE', user: reader(), admin: true})).status).toBe(204);
        expect(model.deleteSubject).toHaveBeenCalledWith(INFANTINO.qid);
    });
});
