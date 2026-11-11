//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.api-log.js
//  Description: The journal of /api/v1: one line in the log of the server for each request, the refused ones too, with the client,
//               the route, how it ended and how long it took, so that the owner of the server sees when the other party reads the
//               news and how often. Never the key, never the values asked
//

import http from 'node:http';
import process from 'node:process';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';
import {hashOfKey, newApiKey} from '../../services/utils/api-key.js';
import {apiLog} from '../../services/utils/api-log.js';

// the router takes the model of the news, which takes the database: nothing is asked of it here
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {default: v1Router} = await import('../../routes/v1-router.js');

// the routes of the positions are set aside, served only on this word (see v1-router.js): they answer 200 with no database
process.env.V1_POSITIONS_MOCK = 'on';

const app = express();
app.use('/api/v1', v1Router);

// the journal alone, on a route that answers what the test says
const answers = {body: {items: [1, 2, 3]}};
const small = express();
small.get('/small', apiLog(), (req, res) => res.json(answers.body));

const servers = [];
const listen = (target) => new Promise(resolve => { const server = target.listen(0, '127.0.0.1', () => resolve(server)); });
let main, alone;
beforeAll(async () => {
    main = await listen(app);
    alone = await listen(small);
    servers.push(main, alone);
});
afterAll(() => servers.forEach(server => server.close()));

const name = 'footballiq';
const key = newApiKey();
process.env.API_KEYS = `${name}:${hashOfKey(key)}`;

const call = (server, path, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, path, method: 'GET', headers}, res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
});
const bearer = {Authorization: `Bearer ${key}`};

// what the server wrote about /api/v1, once the answer is sent (the line is written when the answer is done)
const lines = [];
jest.spyOn(console, 'log').mockImplementation((line) => { lines.push(String(line)); });
beforeEach(() => { lines.length = 0; });
const journal = async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
    return lines.filter(line => line.startsWith('API v1:'));
};

describe('the journal of /api/v1', () => {
    it('should write one line for a request of a client: who, the route, how it ended, how long, the names of the parameters', async () => {
        expect(await call(main, '/api/v1/subjects?status=declared&since=2026-11-01', bearer)).toBe(200);
        const written = await journal();
        expect(written).toHaveLength(1);
        expect(written[0]).toMatch(/^API v1: footballiq GET \/api\/v1\/subjects 200 \d+ ms params since,status$/);
    });

    it('should write no values and no key: a key put in the address (refused) never stays in the log', async () => {
        await call(main, `/api/v1/subjects?status=declared&key=${key}`, bearer);
        await call(main, `/api/v1/subjects?key=${key}`);
        const written = (await journal()).join('\n');
        expect(written).not.toContain(key);
        expect(written).not.toContain(key.slice(4, 14));
        expect(written).not.toContain('declared');
    });

    it('should write a request with no key, or a wrong one, as a 401 with no client, and the address it came from', async () => {
        await call(main, '/api/v1/subjects');
        await call(main, '/api/v1/subjects', {Authorization: `Bearer ${newApiKey()}`});
        const written = await journal();
        expect(written).toHaveLength(2);
        for (const line of written) expect(line).toMatch(/^API v1: - GET \/api\/v1\/subjects 401 \d+ ms from \S+$/);
    });

    it('should write no address for a request that was let in', async () => {
        await call(main, '/api/v1/subjects', bearer);
        expect((await journal())[0]).not.toContain(' from ');
    });

    it('should write a request that the limit stopped, and a route that does not exist, with their status', async () => {
        expect(await call(main, '/api/v1/nothing', bearer)).toBe(404);
        const other = newApiKey();
        process.env.API_KEYS += `,limited:${hashOfKey(other)}`;
        for (let i = 0; i < 60; i++) await call(main, '/api/v1/subjects', {Authorization: `Bearer ${other}`});
        expect(await call(main, '/api/v1/subjects', {Authorization: `Bearer ${other}`})).toBe(429);
        const written = await journal();
        expect(written.some(line => /^API v1: footballiq GET \/api\/v1\/nothing 404 /.test(line))).toBe(true);
        expect(written.at(-1)).toMatch(/^API v1: limited GET \/api\/v1\/subjects 429 /);
        expect(written).toHaveLength(62);
    });

    it('should not let a parameter name that is no word write anything in the line: one line, no forged one', async () => {
        await call(main, '/api/v1/subjects?%0AAPI%20v1:%20forged=1&a%20b=2&ok=3', bearer);
        const written = await journal();
        expect(written).toHaveLength(1);
        expect(written[0]).not.toContain('forged');
        expect(written[0]).toMatch(/params ok$/);
    });

    it('should say how many items an answer held, and nothing when it held none of that kind', async () => {
        answers.body = {items: [1, 2, 3]};
        await call(alone, '/small');
        answers.body = {items: []};
        await call(alone, '/small');
        answers.body = {subjects: [1]};
        await call(alone, '/small');
        const written = await journal();
        expect(written[0]).toMatch(/ 200 \d+ ms 3 items$/);
        expect(written[1]).toMatch(/ 200 \d+ ms 0 items$/);
        expect(written[2]).toMatch(/ 200 \d+ ms$/);
    });
});
