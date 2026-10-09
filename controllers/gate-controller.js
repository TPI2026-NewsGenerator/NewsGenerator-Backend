//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: gate-controller.js
//  Description: Controller of the password of the site: the check Caddy asks before each request
//               (forward_auth, see deploy/Caddyfile), and the page that takes the password
//

"use strict"

import process from 'node:process';
import {Buffer} from 'node:buffer';
import {verifyPassword} from "../services/utils/pwd-hasher.js";
import {gatePage, isInside, openGate, safeNext, signGate} from "../services/utils/site-gate.js";

const WRONG = 'This is not the password of the site.';
const CLOSED = 'The site is closed: its password is not set on the server.';
const ASKED = 'The password of the site is asked again: reload the page.';

// The page has no script and takes nothing from elsewhere: anything else, an injection, is refused
// by the browser, and no other site may show it in a frame to catch the password
export const GATE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const page = (res, status, options) => res.status(status)
    .set({'Cache-Control': 'no-store', 'Content-Security-Policy': GATE_POLICY}).type('html').send(gatePage(options));

// the passwords refused, in the log of the server: tries from many addresses are seen there
const refused = (req, why) => console.warn(`Site gate: ${why} from ${req.ip}`);

// The hash of `caddy hash-password` is a bcrypt hash; older versions of Caddy gave it in base64
const siteHash = () => {
    const hash = process.env.SITE_PASSWORD_HASH ?? '';
    if (hash.startsWith('$2')) return hash;
    const decoded = Buffer.from(hash, 'base64').toString('utf8');
    return decoded.startsWith('$2') ? decoded : null;
};

export const GateController = {
    // 204 when the cookie is valid: Caddy serves what was asked. Otherwise Caddy sends this answer
    // instead: the page of the password for a page, an error the client shows for the API
    check: (req, res) => {
        if (signGate() === null || siteHash() === null) return page(res, 503, {error: CLOSED});
        if (isInside(req)) return res.status(204).end();
        const asked = req.get('X-Forwarded-Uri') ?? '/';
        if (asked.startsWith('/api/')) return res.status(401).set('Cache-Control', 'no-store').json({error: ASKED});
        return page(res, 401, {next: asked});
    },

    // the form of the page: the right password opens the site for 30 days and goes back where the reader was
    enter: async (req, res) => {
        const next = safeNext(req.body?.next);
        const hash = siteHash();
        if (signGate() === null || hash === null) return page(res, 503, {error: CLOSED});
        const password = req.body?.password;
        if (typeof password !== 'string' || password === '' || password.length > 200) {
            refused(req, 'no password');
            return page(res, 401, {next, error: WRONG});
        }
        try {
            if (!await verifyPassword(password, hash)) {
                refused(req, 'wrong password');
                return page(res, 401, {next, error: WRONG});
            }
        } catch (error) {
            console.error(`Site gate: password not checked (${error.message})`);
            return page(res, 503, {next, error: CLOSED});
        }
        openGate(req, res);
        return res.redirect(303, next);
    },
};
