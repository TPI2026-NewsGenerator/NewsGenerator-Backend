//
//  Author: Fabian Rostello
//  Date: 10.10.2026
//  File: test.mail-original.js
//  Description: The copy of an e-mail kept as it was sent, read by anyone with its link, as a page
//               where nothing runs; the link sent with the address of the site the reader reached
//

import http from 'node:http';
import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import express from 'express';

const original = jest.fn();
const email = jest.fn(async () => {});
jest.unstable_mockModule('../../services/briefing-service.js', () => ({BriefingService: {original, email}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({mailEnabled: () => true}));
jest.unstable_mockModule('../../services/utils/admin.js', () => ({isAdmin: async () => true}));
const {default: mailRouter} = await import('../../routes/mail-router.js');
const {BriefingController} = await import('../../controllers/briefing-controller.js');

const app = express();
app.set('trust proxy', 'loopback');
app.use('/api/mails', mailRouter);
app.post('/api/briefing/:id/email', express.json(), (req, res, next) => { req.user = {id: 4}; next(); }, BriefingController.email);

let server;
beforeAll(async () => { await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); });
afterAll(() => server.close());
beforeEach(() => {
    original.mockReset();
    email.mockClear();
});

// {status, type, headers, text}: through node:http, which sends the Host header given
const request = (method, path, {headers = {}, body} = {}) => new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: server.address().port, method, path,
        headers: {...headers, ...(body ? {'Content-Type': 'application/json'} : {})}}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({status: res.statusCode, type: String(res.headers['content-type']).split(';')[0], headers: res.headers, text}));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
});

describe('GET /api/mails/:token', () => {
    it('should show the e-mail as it was sent, with no account, as a page where nothing runs and no other site frames it', async () => {
        original.mockResolvedValue({subject: 'S', html: '<!doctype html><p>As sent</p>'});
        const res = await request('GET', '/api/mails/abcdefghijklmnopqrstuvwx');

        expect(res.status).toBe(200);
        expect(res.type).toBe('text/html');
        expect(res.text).toContain('As sent');
        expect(original).toHaveBeenCalledWith('abcdefghijklmnopqrstuvwx');
        expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
        expect(res.headers['content-security-policy']).not.toMatch(/script-src/);
        expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
        expect(res.headers['x-robots-tag']).toMatch(/noindex/);
        expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('should say no e-mail has an unknown token, in a page', async () => {
        original.mockRejectedValue(Object.assign(new Error('No e-mail has this address.'), {status: 404}));
        const res = await request('GET', '/api/mails/unknown');
        expect(res.status).toBe(404);
        expect(res.type).toBe('text/html');
        expect(res.text).toContain('No e-mail has this address.');
    });
});

describe('POST /api/briefing/:id/email', () => {
    it('should give the address of the site the reader reached, the https of the tunnel kept', async () => {
        await request('POST', '/api/briefing/7/email', {headers: {Host: 'news.example', 'X-Forwarded-Proto': 'https'}, body: {storyIds: [1]}});
        expect(email.mock.calls[0][7]).toBe('https://news.example');
    });

    it('should give none for a host that is not one', async () => {
        await request('POST', '/api/briefing/7/email', {headers: {Host: 'evil.example"><a'}, body: {storyIds: [1]}});
        expect(email.mock.calls[0][7]).toBeNull();
    });
});
