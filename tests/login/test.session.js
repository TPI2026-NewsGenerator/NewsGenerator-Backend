//
//  Author: Fabian Rostello
//  Date: 02.10.2026
//  File: test.session.js
//  Description: Tests of the session kept in an HttpOnly cookie
//

import {jest} from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.ACCESS_TOKEN_SECRET = 'a-secret-of-the-tests';
const {authenticateToken, cookieOf, generateAccessToken} = await import('../../services/utils/jwt.js');

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
    it('should let a reader with a valid session cookie through, as the user of the token', () => {
        const req = request(`session=${generateAccessToken(user)}`);
        const next = jest.fn();
        authenticateToken(req, response(), next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toMatchObject(user);
    });

    it('should refuse a request without the cookie, even with a token in the header', () => {
        const req = {get: (name) => (name === 'Authorization' ? `Bearer ${generateAccessToken(user)}` : undefined)};
        const res = response();
        const next = jest.fn();
        authenticateToken(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should renew a session older than a day, and only then', () => {
        const old = jwt.sign({...user, iat: Math.floor(Date.now() / 1000) - 2 * 24 * 3600}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '7d'});
        const res = response();
        authenticateToken(request(`session=${old}`), res, jest.fn());
        expect(res.cookie).toHaveBeenCalledWith('session', expect.any(String), expect.objectContaining({httpOnly: true}));

        const fresh = response();
        authenticateToken(request(`session=${generateAccessToken(user)}`), fresh, jest.fn());
        expect(fresh.cookie).not.toHaveBeenCalled();
    });
});
