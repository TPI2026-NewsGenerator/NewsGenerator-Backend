//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: test.signup-closed.js
//  Description: Tests for the accounts made only when SIGNUP_OPEN=1: the signup refused, the questions
//               of the AI asked by readers with an account only, and the page told
//

import {afterAll, beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals'
import process from 'node:process';
import express from 'express';

// the routes only: what they let through answers as the services would to a request too short
const fail = (status) => Object.assign(new Error('refused'), {status});
jest.unstable_mockModule('../../controllers/signup-controller.js', () => ({
    SignupController: {register: (req, res) => res.status(400).json({error: 'A username is 3 to 30 letters.'})},
}));
jest.unstable_mockModule('../../services/profile-service.js', () => ({
    ProfileService: {funnelQuestions: jest.fn(async () => { throw fail(422); }), funnelText: jest.fn(async () => { throw fail(422); })},
}));
jest.unstable_mockModule('../../services/feed-service.js', () => ({FeedService: {languages: () => ['en', 'fr']}}));
jest.unstable_mockModule('../../services/utils/active-profile.js', () => ({activeProfile: (req, res, next) => next(), needsProfile: (req, res, next) => next()}));
jest.unstable_mockModule('../../services/utils/password-changes.js', () => ({passwordChangedAt: async () => 0, notePasswordChange: () => {}}));

const {default: signupRouter} = await import('../../routes/signup-router.js');
const {default: profileRouter} = await import('../../routes/profile-router.js');
const {ProfileService} = await import('../../services/profile-service.js');

let server;
let base;

const env = {...process.env};
beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/signup', signupRouter);
    app.use('/api/profile', profileRouter);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
    server.close();
    process.env = env;
});
beforeEach(() => {
    process.env.ACCESS_TOKEN_SECRET = 'a secret of the sessions of at least 32 characters';
    delete process.env.SIGNUP_OPEN;
});

const post = (path, body) => fetch(`${base}/api${path}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
});
// too short to be read: refused before the AI or the database when the route lets it through
const SHORT = {start: 'Tennis', rounds: [], language: 'en'};

describe('the signup closed', () => {
    it('should refuse to make an account unless SIGNUP_OPEN is 1', async () => {
        for (const value of [undefined, '0', 'true', 'yes']) {
            if (value === undefined) delete process.env.SIGNUP_OPEN; else process.env.SIGNUP_OPEN = value;
            const answer = await post('/signup', {username: 'someone', email: 'someone@example.com', password: 'a long password'});
            expect(answer.status).toBe(403);
            expect(await answer.json()).toEqual({error: 'Account creation is closed.'});
        }
    });

    it('should ask an account for the questions of the AI', async () => {
        expect((await post('/profile/funnel/questions', SHORT)).status).toBe(403);
        expect((await post('/profile/funnel/text', SHORT)).status).toBe(403);
        expect(ProfileService.funnelQuestions).not.toHaveBeenCalled();
        expect(ProfileService.funnelText).not.toHaveBeenCalled();
    });

    it('should still ask the questions of the AI for a reader signed in, for a new profile', async () => {
        const {SESSION_COOKIE, generateAccessToken} = await import('../../services/utils/jwt.js');
        const token = generateAccessToken({id: 1, username: 'reader', email: 'reader@example.com', role: 1});
        const answer = await fetch(`${base}/api/profile/funnel/text`, {
            method: 'POST', body: JSON.stringify(SHORT),
            headers: {'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}`},
        });
        expect(answer.status).toBe(422);
        expect(ProfileService.funnelText).toHaveBeenCalled();
    });

    it('should tell the page', async () => {
        const answer = await fetch(`${base}/api/profile/options`);
        expect((await answer.json()).signup).toBe(false);
    });
});

describe('the signup open', () => {
    beforeEach(() => { process.env.SIGNUP_OPEN = '1'; });

    it('should read the account asked', async () => {
        const answer = await post('/signup', {username: 'a', email: 'someone@example.com', password: 'a long password'});
        expect(answer.status).toBe(400);
    });

    it('should let the questions of the AI come before the account', async () => {
        expect((await post('/profile/funnel/text', SHORT)).status).toBe(422);
        expect((await (await fetch(`${base}/api/profile/options`)).json()).signup).toBe(true);
    });
});
