//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: test.session.js
//  Description: Tests of the session kept in an HttpOnly cookie
//

import process from 'node:process';
import {jest} from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.ACCESS_TOKEN_SECRET = 'a-secret-of-the-tests';
jest.unstable_mockModule('../../services/utils/password-changes.js', () => ({passwordChangedAt: jest.fn()}));
const {authenticateToken, cookieOf, generateAccessToken} = await import('../../services/utils/jwt.js');
const {passwordChangedAt} = await import('../../services/utils/password-changes.js');
const now = () => Math.floor(Date.now() / 1000);

const request = (cookie) => ({get: (name) => (name === 'Cookie' ? cookie : undefined)});
const response = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.cookie = jest.fn(() => res);
    return res;
};
const user = {id: 4, username: 'fab', email: 'fab@example.org', role: 2};

describe('cookieOf', () => {
    it('should read one cookie among others, and nothing when it is missing', () => {
        expect(cookieOf(request('theme=dark; session=abc.def=; lang=fr'), 'session')).toBe('abc.def=');
        expect(cookieOf(request('theme=dark'), 'session')).toBeNull();
        expect(cookieOf(request(undefined), 'session')).toBeNull();
    });
});

describe('authenticateToken', () => {
    beforeEach(() => passwordChangedAt.mockReset().mockResolvedValue(0));

    it('should let a reader with a valid session cookie through, as the user of the token', async () => {
        const req = request(`session=${generateAccessToken(user)}`);
        const next = jest.fn();
        await authenticateToken(req, response(), next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject(user);
    });

    it('should refuse a request without the cookie, even with a token in the header', async () => {
        const req = {get: (name) => (name === 'Authorization' ? `Bearer ${generateAccessToken(user)}` : undefined)};
        const res = response();
        const next = jest.fn();
        await authenticateToken(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should renew a session older than a day, and only then', async () => {
        const old = jwt.sign({...user, iat: Math.floor(Date.now() / 1000) - 2 * 24 * 3600}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '7d'});
        const res = response();
        await authenticateToken(request(`session=${old}`), res, jest.fn());
        expect(res.cookie).toHaveBeenCalledWith('session', expect.any(String), expect.objectContaining({httpOnly: true}));

        const fresh = response();
        await authenticateToken(request(`session=${generateAccessToken(user)}`), fresh, jest.fn());
        expect(fresh.cookie).not.toHaveBeenCalled();
    });

    it('should refuse a session opened before the password changed, or of an account gone', async () => {
        const before = jwt.sign({...user, iat: now() - 3600}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '7d'});
        passwordChangedAt.mockResolvedValue(now() - 60);
        const res = response();
        const next = jest.fn();
        await authenticateToken(request(`session=${before}`), res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();

        // the session this device got with the change goes on
        await authenticateToken(request(`session=${generateAccessToken(user)}`), response(), next);
        expect(next).toHaveBeenCalledTimes(1);

        passwordChangedAt.mockResolvedValue(null);
        const gone = response();
        await authenticateToken(request(`session=${generateAccessToken(user)}`), gone, jest.fn());
        expect(gone.status).toHaveBeenCalledWith(403);
    });

    it('should say when the session could not be checked, and let nobody through', async () => {
        passwordChangedAt.mockRejectedValue(new Error('database down'));
        const res = response();
        const next = jest.fn();
        await authenticateToken(request(`session=${generateAccessToken(user)}`), res, next);
        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });
});
