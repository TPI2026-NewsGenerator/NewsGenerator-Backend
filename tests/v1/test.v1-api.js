//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.v1-api.js
//  Description: /api/v1, the read-only routes another system reads with its key: who gets in (a key made by
//               make-api-key.js, only its hash kept, nothing else opens), what the routes answer (the fixed
//               answers the map of a friend is built on: they hold every case of the contract) and the
//               refusals, each naming the parameter. The key is counted apart from the others
//

import {Buffer} from 'node:buffer';
import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, describe, expect, it, jest} from '@jest/globals';
import express from 'express';
import {clientOfKey, clientsOfEnv, hashOfKey, newApiKey} from '../../services/utils/api-key.js';

// the router takes the model of the news, which takes the database: nothing is asked of it here
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {default: v1Router} = await import('../../routes/v1-router.js');

// the positions are set aside, served only on this word (see v1-router.js); the tests of the news are in test.news-export.js
process.env.V1_POSITIONS_MOCK = 'on';

const app = express();
app.use('/api/v1', v1Router);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

// the clients of the server, as API_KEYS lists them: made one by one, each test group counts on its own
const entries = new Map();
const setClients = () => { process.env.API_KEYS = [...entries].map(([name, key]) => `${name}:${hashOfKey(key)}`).join(','); };
let made = 0;
const newClient = () => {
    const name = `client${++made}`;
    const key = newApiKey();
    entries.set(name, key);
    setClients();
    return {name, key};
};

const call = (path, {key, authorization, headers = {}} = {}) => new Promise((resolve, reject) => {
    const sent = {...headers};
    if (authorization !== undefined) sent.Authorization = authorization;
    else if (key !== undefined) sent.Authorization = `Bearer ${key}`;
    const req = http.request({host: '127.0.0.1', port: server.address().port, path: `/api/v1${path}`, method: 'GET', headers: sent}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: text === '' ? null : JSON.parse(text)}));
    });
    req.on('error', reject);
    req.end();
});

describe('the keys', () => {
    it('should make a key of 47 characters with the prefix, from 32 random bytes, never the same twice', () => {
        const key = newApiKey();
        expect(key).toMatch(/^fiq_[A-Za-z0-9_-]{43}$/);
        expect(newApiKey()).not.toBe(key);
    });

    it('should hash a key to 64 hexadecimal characters, the same one each time, and not give the key back', () => {
        const key = newApiKey();
        expect(hashOfKey(key)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashOfKey(key)).toBe(hashOfKey(key));
        expect(hashOfKey(key)).not.toContain(key.slice(4, 14));
    });

    it('should read API_KEYS, and leave out what is not a name and a hash: a typo opens nothing', () => {
        const good = hashOfKey('x');
        expect(clientsOfEnv(`footballiq:${good},other:${good.toUpperCase()}`)).toEqual([{name: 'footballiq', hash: good}, {name: 'other', hash: good}]);
        expect(clientsOfEnv(`broken:abc,:${good},nocolon,bad name:${good},ok:${good}`)).toEqual([{name: 'ok', hash: good}]);
        expect(clientsOfEnv('')).toEqual([]);
        expect(clientsOfEnv(undefined)).toEqual([]);
    });

    it('should tell which client a key is, and none for any other', () => {
        const [a, b] = [newApiKey(), newApiKey()];
        const clients = clientsOfEnv(`a:${hashOfKey(a)},b:${hashOfKey(b)}`);
        expect(clientOfKey(a, clients)).toBe('a');
        expect(clientOfKey(b, clients)).toBe('b');
        expect(clientOfKey(newApiKey(), clients)).toBeNull();
        expect(clientOfKey(a, [])).toBeNull();
    });
});

describe('who gets in', () => {
    let client;
    beforeAll(() => { client = newClient(); });

    it('should answer 401 with no key, in the form of the errors of the group, and tell the scheme asked', async () => {
        const res = await call('/subjects');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({error: {code: 'unauthorized', message: expect.stringContaining('Bearer')}});
        expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    });

    it('should answer 401 for a key that is none of ours, another scheme, a Bearer with nothing or too much', async () => {
        for (const authorization of [`Bearer ${newApiKey()}`, `Basic ${client.key}`, 'Bearer', `Bearer ${client.key} more`, client.key]) {
            expect((await call('/subjects', {authorization})).status).toBe(401);
        }
    });

    it('should let the key of a client in, the word Bearer in small letters too', async () => {
        expect((await call('/subjects', {key: client.key})).status).toBe(200);
        expect((await call('/subjects', {authorization: `bearer ${client.key}`})).status).toBe(200);
    });

    it('should not take the key from the address: it would stay in every log', async () => {
        expect((await call(`/subjects?key=${client.key}`)).status).toBe(401);
        expect((await call('/subjects', {headers: {'X-Api-Key': client.key}})).status).toBe(401);
    });

    it('should let in the client whose entry is there, and no other: a key taken out of API_KEYS opens nothing', async () => {
        const other = newClient();
        expect((await call('/subjects', {key: other.key})).status).toBe(200);
        entries.delete(other.name);
        setClients();
        expect((await call('/subjects', {key: other.key})).status).toBe(401);
        expect((await call('/subjects', {key: client.key})).status).toBe(200);
    });

    it('should let nothing in when API_KEYS is not set', async () => {
        const saved = process.env.API_KEYS;
        delete process.env.API_KEYS;
        expect((await call('/subjects', {key: client.key})).status).toBe(401);
        process.env.API_KEYS = saved;
    });

    it('should answer a route that does not exist with a 404 in the same form, to a client in only', async () => {
        const res = await call('/nothing', {key: client.key});
        expect(res.status).toBe(404);
        expect(res.body).toEqual({error: {code: 'not_found', message: expect.any(String)}});
        expect((await call('/nothing')).status).toBe(401);
    });
});

describe('the limit of a key', () => {
    it('should stop a key at 60 requests a minute, tell when to come back, and not stop another key', async () => {
        const counted = newClient();
        const free = newClient();
        for (let i = 0; i < 60; i++) expect((await call('/subjects', {key: counted.key})).status).toBe(200);
        const res = await call('/subjects', {key: counted.key});
        expect(res.status).toBe(429);
        expect(res.body).toEqual({error: {code: 'rate_limited', message: expect.stringContaining('60 a minute'), retryAfter: expect.any(Number)}});
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        expect((await call('/subjects', {key: free.key})).status).toBe(200);
    });
});

describe('GET /subjects', () => {
    let key;
    beforeAll(() => { key = newClient().key; });

    it('should list the persons followed, with how many associations have a position on each', async () => {
        const res = await call('/subjects', {key});
        expect(res.status).toBe(200);
        expect(res.body.mock).toBe(true);
        expect(res.body.subjects.map(s => [s.qid, s.status, s.state, s.positions_known])).toEqual([
            ['Q124138', 'incumbent', 'ready', 6],
            ['Q000010', 'declared', 'ready', 1],
            ['Q000011', 'rumoured', 'computing', 0],
        ]);
        expect(res.body.subjects[0]).toEqual({qid: 'Q124138', name: 'Gianni Infantino', status: 'incumbent', status_since: null, state: 'ready', news_30d: 8103, positions_known: 6});
    });

    it('should say the answers are fixed ones, and keep them from a shared cache', async () => {
        const res = await call('/subjects', {key});
        expect(res.headers['x-newsgenerator-data']).toBe('mock');
        expect(res.headers['cache-control']).toBe('private, max-age=60');
    });

    it('should list the persons of one status, and refuse any other', async () => {
        expect((await call('/subjects?status=declared', {key})).body.subjects.map(s => s.qid)).toEqual(['Q000010']);
        expect((await call('/subjects?status=withdrawn', {key})).body.subjects).toEqual([]);
        const res = await call('/subjects?status=winner', {key});
        expect(res.status).toBe(422);
        expect(res.body.error).toMatchObject({code: 'invalid_parameter', parameter: 'status'});
    });

    it('should let a client that sends the same answer back keep its copy: 304', async () => {
        const first = await call('/subjects', {key});
        expect(first.headers.etag).toBeTruthy();
        const again = await call('/subjects', {key, headers: {'If-None-Match': first.headers.etag}});
        expect(again.status).toBe(304);
    });
});

describe('GET /positions', () => {
    let key;
    beforeAll(() => { key = newClient().key; });

    it('should give the 10 associations of a subject, the confederations apart, as the doc shows the first', async () => {
        const res = await call('/positions?subject=Q124138', {key});
        expect(res.status).toBe(200);
        expect(res.body.subject).toMatchObject({qid: 'Q124138', name: 'Gianni Infantino', state: 'ready'});
        expect(res.body.updated_at).toBe('2026-11-10T21:00:00Z');
        expect(res.body.positions).toHaveLength(10);
        expect(res.body.positions.every(p => p.association.level === 'association')).toBe(true);
        expect(res.body.positions[0]).toEqual({
            association: {qid: 'Q000001', fifa: 'XXA', name: 'Fédération Exemple A', confederation: 'UEFA', level: 'association'},
            position: 'non_soutien_declare', since: '2026-11-08',
            previous: {position: 'soutien_declare', since: '2026-10-14'},
            changed: true, confidence: 'high', stale: false,
            signals_count: 6, last_signal_at: '2026-11-08T09:12:00Z',
        });
    });

    it('should give an association that has said nothing as unknown, with nothing else filled', async () => {
        const row = (await call('/positions?subject=Q124138', {key})).body.positions.find(p => p.association.fifa === 'XXB');
        expect(row).toMatchObject({position: 'inconnue', since: null, previous: null, changed: false, confidence: null, stale: false, signals_count: 0, last_signal_at: null});
    });

    it('should hold every case of the contract: the five positions, one reversal, one position gone stale', async () => {
        const rows = (await call('/positions?subject=Q124138', {key})).body.positions;
        expect(new Set(rows.map(p => p.position))).toEqual(new Set(['soutien_declare', 'soutien_probable', 'inconnue', 'non_soutien_probable', 'non_soutien_declare']));
        expect(rows.filter(p => p.changed).map(p => p.association.fifa)).toEqual(['XXA']);
        expect(rows.filter(p => p.stale).map(p => p.association.fifa)).toEqual(['XXG']);
        // the weakened one is of the same side: not a reversal
        expect(rows.find(p => p.association.fifa === 'XXH')).toMatchObject({position: 'soutien_probable', previous: {position: 'soutien_declare'}, changed: false});
    });

    it('should give no two things the same QID (a candidate and an association were once both Q000010), nor two the same code', async () => {
        const subjects = (await call('/subjects', {key})).body.subjects;
        const rows = (await call('/positions?subject=Q124138&include=confederations', {key})).body.positions;
        const qids = [...subjects.map(s => s.qid), ...rows.map(p => p.association.qid)];
        expect(new Set(qids).size).toBe(qids.length);
        const codes = rows.map(p => p.association.fifa);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('should add the confederations when asked, and only then', async () => {
        const res = await call('/positions?subject=Q124138&include=confederations', {key});
        expect(res.body.positions).toHaveLength(12);
        expect(res.body.positions.filter(p => p.association.level === 'confederation').map(p => p.association.fifa)).toEqual(['XCU', 'XCA']);
    });

    it('should give a candidate declared a few days ago as grey, but one, and one whose reading runs as all unknown', async () => {
        const declared = await call('/positions?subject=Q000010', {key});
        expect(declared.body.positions.filter(p => p.position !== 'inconnue').map(p => [p.association.fifa, p.position, p.confidence])).toEqual([['XXA', 'soutien_probable', 'low']]);
        const running = await call('/positions?subject=Q000011', {key});
        expect(running.body.subject).toMatchObject({state: 'computing', positions_known: 0});
        expect(running.body.positions.every(p => p.position === 'inconnue')).toBe(true);
    });

    it('should refuse a subject that is missing, is no QID or is given twice, naming it', async () => {
        for (const path of ['/positions', '/positions?subject=', '/positions?subject=infantino', '/positions?subject=Q0', '/positions?subject=Q1&subject=Q2']) {
            const res = await call(path, {key});
            expect(res.status).toBe(422);
            expect(res.body.error).toMatchObject({code: 'invalid_parameter', parameter: 'subject'});
        }
    });

    it('should answer 404 for a person that is not followed, and point to the list', async () => {
        const res = await call('/positions?subject=Q999999', {key});
        expect(res.status).toBe(404);
        expect(res.body.error).toMatchObject({code: 'unknown_subject', message: expect.stringContaining('/api/v1/subjects')});
    });

    it('should refuse a value of include or lang that is not offered', async () => {
        expect((await call('/positions?subject=Q124138&include=all', {key})).body.error.parameter).toBe('include');
        expect((await call('/positions?subject=Q124138&lang=de', {key})).body.error.parameter).toBe('lang');
    });
});

describe('GET /positions/{id}', () => {
    let key;
    beforeAll(() => { key = newClient().key; });

    it('should give the position of an association and its signals, the newest first, as the doc shows', async () => {
        const res = await call('/positions/XXA?subject=Q124138', {key});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            association: {qid: 'Q000001', fifa: 'XXA', confederation: 'UEFA'},
            subject: {qid: 'Q124138', name: 'Gianni Infantino'},
            position: 'non_soutien_declare', since: '2026-11-08', changed: true, confidence: 'high', stale: false,
        });
        expect(res.body.signals.map(s => [s.id, s.date, s.stance, s.mark])).toEqual([
            ['sig_0002', '2026-11-08', 'against', 'official'],
            ['sig_0001', '2026-10-14', 'for', 'official'],
        ]);
        expect(res.body.signals[0]).toEqual({
            id: 'sig_0002', date: '2026-11-08', stance: 'against',
            target: {qid: 'Q124138', name: 'Gianni Infantino', kind: 'incumbent'},
            mark: 'official',
            speaker: {name: 'Prénom Nom', qid: null, role: 'président de la fédération', binds: true},
            sentence: 'Exemple fictif : la fédération ne soutiendra pas un nouveau mandat.', lang: 'fr',
            translation: null, translation_by: null,
            url: 'https://exemple.org/article-2', medium: 'exemple.org', published_at: '2026-11-08T09:12:00Z',
            news_count: 7, media_count: 5, read_by: 'ai', checked: true,
        });
    });

    it('should take the code of the FIFA in any case, or the QID, for the same association', async () => {
        const byCode = (await call('/positions/XXA?subject=Q124138', {key})).body;
        expect((await call('/positions/xxa?subject=Q124138', {key})).body).toEqual(byCode);
        expect((await call('/positions/Q000001?subject=Q124138', {key})).body).toEqual(byCode);
    });

    it('should translate the sentences that are not in the language asked, and only those', async () => {
        const fr = (await call('/positions/XXA?subject=Q124138&lang=fr', {key})).body.signals;
        expect(fr[0]).toMatchObject({lang: 'fr', translation: null, translation_by: null});
        expect(fr[1]).toMatchObject({lang: 'en', translation: 'Exemple seulement : la fédération soutient le président actuel.', translation_by: 'ai'});
        const en = (await call('/positions/XXA?subject=Q124138&lang=en', {key})).body.signals;
        expect(en[0]).toMatchObject({lang: 'fr', translation: 'Example only: the federation will not back a new term.', translation_by: 'ai'});
        expect(en[1]).toMatchObject({lang: 'en', translation: null});
    });

    it('should keep the signals from a day on, and at most `limit`', async () => {
        expect((await call('/positions/XXA?subject=Q124138&limit=1', {key})).body.signals.map(s => s.id)).toEqual(['sig_0002']);
        expect((await call('/positions/XXA?subject=Q124138&since=2026-11-01', {key})).body.signals.map(s => s.id)).toEqual(['sig_0002']);
        expect((await call('/positions/XXA?subject=Q124138&since=2026-11-09', {key})).body.signals).toEqual([]);
    });

    it('should give no signal to an association that said nothing, and name the speaker who binds nothing', async () => {
        expect((await call('/positions/XXB?subject=Q124138', {key})).body).toMatchObject({position: 'inconnue', signals: []});
        const vice = (await call('/positions/XXD?subject=Q124138', {key})).body.signals[0];
        expect(vice.speaker).toMatchObject({role: 'vice-président', binds: false});
        const rumour = (await call('/positions/XXE?subject=Q124138', {key})).body.signals[0];
        expect(rumour).toMatchObject({mark: 'reported', speaker: {name: null, binds: false}});
    });

    it('should name a candidate as a candidate, not the incumbent', async () => {
        const res = await call('/positions/XXA?subject=Q000010', {key});
        expect(res.body.position).toBe('soutien_probable');
        expect(res.body.signals[0].target).toEqual({qid: 'Q000010', name: 'Candidat Exemple A', kind: 'candidate'});
    });

    it('should give the position on every person followed when no subject is asked, with no signal', async () => {
        const res = await call('/positions/XXA', {key});
        expect(res.status).toBe(200);
        expect(res.body.association.fifa).toBe('XXA');
        expect(res.body.subjects.map(s => [s.subject.qid, s.position])).toEqual([
            ['Q124138', 'non_soutien_declare'], ['Q000010', 'soutien_probable'], ['Q000011', 'inconnue'],
        ]);
        expect(JSON.stringify(res.body)).not.toContain('"signals"');
    });

    it('should answer 404 for an association that is none, and 422 for a limit or a day that is none', async () => {
        expect((await call('/positions/ZZZ?subject=Q124138', {key})).body.error.code).toBe('unknown_association');
        for (const [query, parameter] of [['limit=0', 'limit'], ['limit=201', 'limit'], ['limit=ten', 'limit'], ['since=2026-02-30', 'since'], ['since=yesterday', 'since'], ['lang=de', 'lang']]) {
            const res = await call(`/positions/XXA?subject=Q124138&${query}`, {key});
            expect(res.status).toBe(422);
            expect(res.body.error.parameter).toBe(parameter);
        }
    });
});

describe('GET /positions/changes', () => {
    let key;
    beforeAll(() => { key = newClient().key; });

    it('should give what changed since a day, the newest first: a reversal, a first position, a position weakened', async () => {
        const res = await call('/positions/changes?subject=Q124138&since=2026-11-01', {key});
        expect(res.status).toBe(200);
        expect(res.body.subject).toEqual({qid: 'Q124138', name: 'Gianni Infantino'});
        expect(res.body.changes).toEqual([
            {association: {qid: 'Q000001', fifa: 'XXA', name: 'Fédération Exemple A'}, kind: 'reversal', from: 'soutien_declare', to: 'non_soutien_declare', at: '2026-11-08', signal_id: 'sig_0002'},
            {association: {qid: 'Q000003', fifa: 'XXC', name: 'Fédération Exemple C'}, kind: 'first', from: 'inconnue', to: 'soutien_declare', at: '2026-11-06', signal_id: 'sig_0010'},
            {association: {qid: 'Q000008', fifa: 'XXH', name: 'Fédération Exemple H'}, kind: 'weakened', from: 'soutien_declare', to: 'soutien_probable', at: '2026-11-02', signal_id: 'sig_0051'},
        ]);
    });

    it('should not take "changes" for an association', async () => {
        const res = await call('/positions/changes?subject=Q124138&since=2026-11-01', {key});
        expect(res.body).not.toHaveProperty('association');
    });

    it('should give the changes of one kind, and none when nothing moved since', async () => {
        expect((await call('/positions/changes?subject=Q124138&since=2026-10-01&kind=first', {key})).body.changes.map(c => c.association.fifa)).toEqual(['XXC', 'XXE', 'XXD']);
        expect((await call('/positions/changes?subject=Q124138&since=2026-11-09', {key})).body.changes).toEqual([]);
    });

    it('should leave the confederations out: they are no voters', async () => {
        const res = await call('/positions/changes?subject=Q124138&since=2026-01-01', {key});
        expect(res.body.changes.filter(c => c.association.fifa.startsWith('XC'))).toEqual([]);
    });

    it('should refuse a day that is missing, one that does not exist, a kind that is not offered, a subject that is missing', async () => {
        for (const [query, parameter] of [['subject=Q124138', 'since'], ['subject=Q124138&since=2026-13-01', 'since'], ['subject=Q124138&since=2026-11-01&kind=moved', 'kind'], ['since=2026-11-01', 'subject']]) {
            const res = await call(`/positions/changes?${query}`, {key});
            expect(res.status).toBe(422);
            expect(res.body.error.parameter).toBe(parameter);
        }
        expect((await call('/positions/changes?subject=Q999999&since=2026-11-01', {key})).status).toBe(404);
    });
});

describe('what is never given', () => {
    it('should give the sentence and the public link of a news, nothing of the key, the server or a reader', async () => {
        const {key} = newClient();
        const text = JSON.stringify([
            (await call('/subjects', {key})).body,
            (await call('/positions?subject=Q124138&include=confederations', {key})).body,
            (await call('/positions/XXA?subject=Q124138', {key})).body,
        ]);
        expect(text).not.toContain(key);
        expect(text).not.toMatch(/192\.168\.|localhost|127\.0\.0\.1|rss-bridge|api_key|token/i);
        const urls = text.match(/https?:\/\/[^"]+/g) ?? [];
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.every(url => url.startsWith('https://exemple.org/'))).toBe(true);
        expect(Buffer.byteLength(text)).toBeLessThan(64 * 1024);
    });
});
