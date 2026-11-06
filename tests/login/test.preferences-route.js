//
//  Author: Fabian Rostello
//  Date: 06.11.2026
//  File: test.preferences-route.js
//  Description: The display preferences of the signed in reader, read and saved by GET and PUT /api/account/preferences: the account is
//               the one of the session, only the keys sent change, a refusal saves nothing, and the routes are counted by account
//

import {Buffer} from 'node:buffer';
import http from 'node:http';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';

// the session of the account 482, or no session when `signedIn` is false
let signedIn = true;
let sessionId = 482;
jest.unstable_mockModule('../../services/utils/jwt.js', () => ({
    authenticateToken: (req, res, next) => {
        if (!signedIn) return res.status(403).json({error: 'Forbidden, invalid or expired token... Please try to log in'});
        req.user = {id: sessionId, username: 'lecteur', email: 'lecteur@example.org', role: 2};
        next();
    },
    generateAccessToken: () => 'token',
    startSession: () => {},
}));

// the column preferences as the database keeps it, merged as `preferences || $1::jsonb` does: the keys sent put over the ones kept
const accounts = new Map();
const preferences = jest.fn(async (id) => accounts.get(id) ?? null);
const mergePreferences = jest.fn(async (id, changes) => {
    if (!accounts.has(id)) return null;
    accounts.set(id, {...accounts.get(id), ...changes});
    return accounts.get(id);
});
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {preferences, mergePreferences}}));
const {default: accountRouter} = await import('../../routes/account-router.js');

const app = express();
app.use(express.json());
app.use('/api/account', accountRouter);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());

const call = (method, body) => new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: '/api/account/preferences', method,
        headers: text === undefined ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text)},
    }, res => {
        let answer = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { answer += chunk; });
        res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(answer)}));
    });
    req.on('error', reject);
    req.end(text);
});
const get = () => call('GET');
const put = (body) => call('PUT', body);

beforeEach(() => {
    signedIn = true;
    sessionId = 482;
    accounts.clear();
    accounts.set(482, {});
    accounts.set(7, {size: 10});
    preferences.mockClear();
    mergePreferences.mockClear();
});

describe('GET /api/account/preferences', () => {
    it('should give {} to a reader who set none', async () => {
        const res = await get();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({preferences: {}});
    });

    it('should give the preferences of the account of the session, and only those', async () => {
        accounts.set(482, {layout: 'matrix', size: 20});
        const res = await get();
        expect(res.body).toEqual({preferences: {layout: 'matrix', size: 20}});
        expect(preferences).toHaveBeenCalledWith(482);
    });

    it('should answer 403 with no session, and read nothing', async () => {
        signedIn = false;
        const res = await get();
        expect(res.status).toBe(403);
        expect(preferences).not.toHaveBeenCalled();
    });

    it('should answer 404 for an account gone', async () => {
        sessionId = 999;
        const res = await get();
        expect(res.status).toBe(404);
    });

    it('should not tell what went wrong inside when the database fails', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
        preferences.mockRejectedValueOnce(new Error('connection to 192.168.1.135:5433 refused'));
        const res = await get();
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Your preferences could not be read or saved right now.');
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection to'));
        logged.mockRestore();
    });
});

describe('PUT /api/account/preferences', () => {
    it('should save what is sent and answer all the preferences now kept', async () => {
        const res = await put({layout: 'matrix'});
        expect(res.status).toBe(200);
        expect(res.body).toEqual({preferences: {layout: 'matrix'}});
        expect(mergePreferences).toHaveBeenCalledWith(482, {layout: 'matrix'});
    });

    it('should change only the keys sent: the others stay as they were', async () => {
        accounts.set(482, {layout: 'matrix', size: 20, followingNews: 50, show: 'short'});
        const res = await put({size: 30, format: 'digest'});
        expect(res.body.preferences).toEqual({layout: 'matrix', size: 30, followingNews: 50, show: 'short', format: 'digest'});
        // the model is given only what was sent, never the preferences kept
        expect(mergePreferences).toHaveBeenCalledWith(482, {size: 30, format: 'digest'});
        expect((await get()).body.preferences).toEqual(res.body.preferences);
    });

    it('should replace a list of presets as a whole, and leave the other scope as it is', async () => {
        accounts.set(482, {
            mailPresets: {short: ['media'], standard: ['picture']},
            pagePresets: {short: ['names']},
        });
        const res = await put({mailPresets: {short: ['contested', 'official']}});
        expect(res.body.preferences).toEqual({mailPresets: {short: ['contested', 'official']}, pagePresets: {short: ['names']}});
    });

    it('should take several saves one after the other, each keeping the earlier ones', async () => {
        await put({layout: 'matrix'});
        await put({show: 'standard'});
        await put({followingNews: 40});
        expect((await get()).body).toEqual({preferences: {layout: 'matrix', show: 'standard', followingNews: 40}});
    });

    it('should save for the account of the session, never one named in the request', async () => {
        const res = await put({id: 7, size: 30});
        expect(res.status).toBe(400);
        expect(accounts.get(7)).toEqual({size: 10});
        expect(accounts.get(482)).toEqual({});
        await put({size: 30});
        expect(mergePreferences).toHaveBeenLastCalledWith(482, {size: 30});
        expect(accounts.get(7)).toEqual({size: 10});
    });

    it('should refuse a key that is no preference, a value that is not offered or an empty body, and save nothing', async () => {
        const refusals = [
            [{theme: 'dark'}, /theme is not a preference/],
            [{layout: 'carousel'}, /layout: one of frames, matrix/],
            [{size: 25}, /size: one of 10, 20, 30/],
            [{followingNews: 105}, /followingNews: one of 10, 20/],
            [{mailPresets: {short: ['sparkles']}}, /mailPresets/],
            [{size: 20, layout: 'carousel'}, /layout/],
            [{}, /at least one/],
            [[1, 2], /as an object/],
        ];
        for (const [body, message] of refusals) {
            const res = await put(body);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(message);
        }
        expect(mergePreferences).not.toHaveBeenCalled();
        expect(accounts.get(482)).toEqual({});
    });

    it('should refuse a body over 4096 bytes with 413, and save nothing', async () => {
        const res = await put({size: 20, padding: 'x'.repeat(5000)});
        expect(res.status).toBe(413);
        expect(mergePreferences).not.toHaveBeenCalled();
    });

    it('should answer 403 with no session, and save nothing', async () => {
        signedIn = false;
        const res = await put({size: 20});
        expect(res.status).toBe(403);
        expect(mergePreferences).not.toHaveBeenCalled();
    });

    it('should answer 404 for an account gone', async () => {
        sessionId = 999;
        const res = await put({size: 20});
        expect(res.status).toBe(404);
    });

    it('should not tell what went wrong inside when the database fails', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
        mergePreferences.mockRejectedValueOnce(new Error('connection to 192.168.1.135:5433 refused'));
        const res = await put({size: 20});
        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Your preferences could not be read or saved right now.');
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('connection to'));
        logged.mockRestore();
    });
});

describe('the limits of the preferences', () => {
    it('should stop the reads of one account at 60 in 10 minutes, and not those of another', async () => {
        sessionId = 31;
        accounts.set(31, {});
        for (let i = 0; i < 60; i++) expect((await get()).status).toBe(200);
        const res = await get();
        expect(res.status).toBe(429);
        expect(res.body).toMatchObject({error: expect.stringContaining('Too many preferences read'), retryAfter: expect.any(Number)});

        sessionId = 32;
        accounts.set(32, {});
        expect((await get()).status).toBe(200);
    });

    it('should stop the saves of one account at 200 in 10 minutes, apart from the reads', async () => {
        sessionId = 41;
        accounts.set(41, {});
        for (let i = 0; i < 200; i++) expect((await put({size: 20})).status).toBe(200);
        expect((await put({size: 20})).status).toBe(429);
        expect((await get()).status).toBe(200);
    });
});
