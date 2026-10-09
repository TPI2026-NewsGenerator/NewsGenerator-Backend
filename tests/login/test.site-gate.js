//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: test.site-gate.js
//  Description: Tests for the password of the site: its cookie, the check Caddy asks before each
//               request and the form of its page, on a server of the test
//

import {afterAll, beforeAll, beforeEach, describe, expect, it} from '@jest/globals'
import process from 'node:process';
import {Buffer} from 'node:buffer';
import express from 'express';
import bcrypt from 'bcrypt';

const {GATE_COOKIE, gateIssuedAt, gatePage, renewGate, safeNext, signGate} = await import('../../services/utils/site-gate.js');
const {default: gateRouter} = await import('../../routes/gate-router.js');

const PASSWORD = 'the password of the site';
const DAY = 24 * 3600;
let hash;
let server;
let base;

const env = {...process.env};
beforeAll(async () => {
    hash = await bcrypt.hash(PASSWORD, 4);
    const app = express();
    app.use('/api', renewGate);
    app.use('/api/gate', gateRouter);
    app.get('/api/ping', (req, res) => res.json({ok: true}));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
    server.close();
    process.env = env;
});
beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'a secret of the sessions of at least 32 characters';
    process.env.SITE_PASSWORD_HASH = hash;
});

const now = () => Math.floor(Date.now() / 1000);
const cookie = (value) => ({Cookie: `other=1; ${GATE_COOKIE}=${value}`});
// every request of the test comes from one address: the limit of 10 tries counts them all
const send = (body) => fetch(`${base}/api/gate`, {
    method: 'POST', redirect: 'manual',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(body),
});

describe('the cookie of the site', () => {
    it('should be valid when signed here and less than 30 days old', () => {
        expect(gateIssuedAt(signGate(now()))).toBe(now());
        expect(gateIssuedAt(signGate(now() - 29 * DAY))).toBe(now() - 29 * DAY);
    });

    it('should be refused when old, from the future, changed or of another key', () => {
        expect(gateIssuedAt(signGate(now() - 31 * DAY))).toBeNull();
        expect(gateIssuedAt(signGate(now() + 3600))).toBeNull();
        const value = signGate(now() - 10 * DAY);
        expect(gateIssuedAt(value.replace(/\.(\d+)\./, `.${now()}.`))).toBeNull();
        expect(gateIssuedAt(`${value}x`)).toBeNull();
        expect(gateIssuedAt('v2' + value.slice(2))).toBeNull();
        expect(gateIssuedAt(null)).toBeNull();
        expect(gateIssuedAt('')).toBeNull();
        // a new password of the site: the cookies of the old one are refused
        process.env.SITE_PASSWORD_HASH = `${hash}x`;
        expect(gateIssuedAt(value)).toBeNull();
    });

    it('should never be given nor accepted without the secret or the hash', () => {
        const value = signGate();
        delete process.env.SITE_PASSWORD_HASH;
        expect(signGate()).toBeNull();
        expect(gateIssuedAt(value)).toBeNull();
        process.env.SITE_PASSWORD_HASH = hash;
        delete process.env.ACCESS_TOKEN_SECRET;
        expect(gateIssuedAt(value)).toBeNull();
    });
});

describe('where the page goes back to', () => {
    it('should be a page of the site only', () => {
        expect(safeNext('/briefing?day=2')).toBe('/briefing?day=2');
        expect(safeNext('/')).toBe('/');
        for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '/api/profile', 'briefing', '', null, '/a b']) {
            expect(safeNext(next)).toBe('/');
        }
    });

    it('should write what it is given as text in the page', () => {
        const page = gatePage({next: '/search?q="><script>alert(1)</script>', error: '<b>'});
        expect(page).not.toContain('<script>alert');
        expect(page).toContain('&lt;b&gt;');
    });
});

describe('the check Caddy asks', () => {
    it('should let a valid cookie through', async () => {
        const answer = await fetch(`${base}/api/gate/check`, {headers: {...cookie(signGate()), 'X-Forwarded-Uri': '/briefing'}});
        expect(answer.status).toBe(204);
    });

    it('should answer the page of the password for a page, with where to go back', async () => {
        const answer = await fetch(`${base}/api/gate/check`, {headers: {'X-Forwarded-Uri': '/profile?new=1'}});
        expect(answer.status).toBe(401);
        expect(answer.headers.get('content-type')).toMatch(/text\/html/);
        expect(answer.headers.get('cache-control')).toBe('no-store');
        expect(answer.headers.get('www-authenticate')).toBeNull();
        const page = await answer.text();
        expect(page).toContain('name="next" value="/profile?new=1"');
        expect(page).toContain('action="/api/gate"');
    });

    it('should answer an error in JSON for the API, and refuse an old cookie', async () => {
        const answer = await fetch(`${base}/api/gate/check`, {headers: {...cookie(signGate(now() - 31 * DAY)), 'X-Forwarded-Uri': '/api/briefing'}});
        expect(answer.status).toBe(401);
        expect(await answer.json()).toEqual({error: 'The password of the site is asked again: reload the page.'});
    });

    it('should keep the site shut without the hash', async () => {
        delete process.env.SITE_PASSWORD_HASH;
        const answer = await fetch(`${base}/api/gate/check`, {headers: {'X-Forwarded-Uri': '/'}});
        expect(answer.status).toBe(503);
    });
});

describe('the form of the page', () => {
    it('should open the site for 30 days with the right password, and go back where the reader was', async () => {
        const answer = await send({password: PASSWORD, next: '/following'});
        expect(answer.status).toBe(303);
        expect(answer.headers.get('location')).toBe('/following');
        const set = answer.headers.get('set-cookie');
        expect(set).toMatch(new RegExp(`^${GATE_COOKIE}=v1\\.`));
        expect(set).toMatch(/Max-Age=2592000/);
        expect(set).toMatch(/HttpOnly/);
        expect(set).toMatch(/SameSite=Lax/);
        expect(set).toMatch(/Path=\//);
        expect(gateIssuedAt(set.match(/=([^;]+)/)[1])).not.toBeNull();
    });

    it('should never send the reader to another site', async () => {
        const answer = await send({password: PASSWORD, next: '//evil.example/'});
        expect(answer.headers.get('location')).toBe('/');
    });

    it('should show the page again with the error for a wrong password, and give no cookie', async () => {
        const answer = await send({password: 'a guess', next: '/briefing'});
        expect(answer.status).toBe(401);
        expect(answer.headers.get('set-cookie')).toBeNull();
        const page = await answer.text();
        expect(page).toContain('This is not the password of the site.');
        expect(page).toContain('value="/briefing"');
        expect((await send({next: '/'})).status).toBe(401);
    });

    it('should accept the hash of an older Caddy, in base64', async () => {
        process.env.SITE_PASSWORD_HASH = Buffer.from(hash).toString('base64');
        expect((await send({password: PASSWORD})).status).toBe(303);
    });
});

describe('the cookie in use', () => {
    it('should be given again once it is more than a day old, not before', async () => {
        const old = await fetch(`${base}/api/ping`, {headers: cookie(signGate(now() - 2 * DAY))});
        expect(gateIssuedAt(old.headers.get('set-cookie').match(/=([^;]+)/)[1])).toBeGreaterThanOrEqual(now() - 5);
        const fresh = await fetch(`${base}/api/ping`, {headers: cookie(signGate(now() - 3600))});
        expect(fresh.headers.get('set-cookie')).toBeNull();
        const none = await fetch(`${base}/api/ping`);
        expect(none.headers.get('set-cookie')).toBeNull();
    });
});

// last: it spends the tries of the address of the test
describe('passwords tried one after another', () => {
    it('should be stopped after 10 tries in 15 minutes, on the page', async () => {
        let answer;
        for (let tries = 0; tries < 11; tries++) {
            answer = await send({password: 'a guess', next: '/search'});
            if (answer.status === 429) break;
        }
        expect(answer.status).toBe(429);
        expect(answer.headers.get('retry-after')).toMatch(/^\d+$/);
        const page = await answer.text();
        expect(page).toContain('Too many tries from here, try again in 15 minutes.');
        expect(page).toContain('value="/search"');
        // the right password too, until the window is over
        expect((await send({password: PASSWORD})).status).toBe(429);
    });
});
