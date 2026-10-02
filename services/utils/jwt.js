//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: jwt.js
//  Description: JSONWebToken generation and verification, kept in a cookie the page cannot read
//

import process from 'node:process'
import 'dotenv/config';
import jwt from 'jsonwebtoken'
import {passwordChangedAt} from './password-changes.js';

// The token lives in an HttpOnly cookie: a script of the page (a dependency gone bad, a hole in the
// rendering of a title of a feed) cannot read it, as it could in the storage of the browser. Strict:
// the browser never sends it with a request another site starts. Secure when the reader came through
// https (the tunnel of Cloudflare, see app.js), so the API still answers on the local network in http
export const SESSION_COOKIE = 'session';
const SESSION_DAYS = 7;
// a session in use is renewed once a day: a reader who comes back within a week stays signed in
const RENEW_SECONDS = 24 * 3600;
const EXPIRED = 'Forbidden, invalid or expired token... Please try to log in';

export const generateAccessToken = ({id, username, email, role}) =>
    jwt.sign({id, username, email, role}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: `${SESSION_DAYS}d`});

const cookieOptions = (res) => ({
    httpOnly: true,
    sameSite: 'strict',
    secure: res.req?.secure === true,
    path: '/api',
});

export const startSession = (res, token) =>
    res.cookie(SESSION_COOKIE, token, {...cookieOptions(res), maxAge: SESSION_DAYS * 24 * 3600e3});

export const endSession = (res) => res.clearCookie(SESSION_COOKIE, cookieOptions(res));

// the value of a cookie of the request, null when it has none
export const cookieOf = (req, name) => {
    for (const part of (req.get('Cookie') ?? '').split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) {
            try {
                return decodeURIComponent(value.join('='));
            } catch {
                return null;
            }
        }
    }
    return null;
};

// A token is valid until it expires: a password changed must still end the sessions of the other
// devices. One opened before the last change of password, or of an account gone, is refused
export const authenticateToken = async (req, res, next) => {
    try {
        req.user = jwt.verify(cookieOf(req, SESSION_COOKIE) ?? '', process.env.ACCESS_TOKEN_SECRET);
    } catch {
        return res.status(403).json({error: EXPIRED});
    }
    try {
        const changedAt = await passwordChangedAt(req.user.id);
        if (changedAt === null || changedAt > req.user.iat) return res.status(403).json({error: EXPIRED});
    } catch (error) {
        console.error(`Session: not checked (${error.message})`);
        return res.status(503).json({error: 'Your session could not be checked, try again in a moment.'});
    }
    if (Date.now() / 1000 - req.user.iat > RENEW_SECONDS) startSession(res, generateAccessToken(req.user));
    next(); // Continue to the next middleware or route
};
