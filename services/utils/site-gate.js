//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: site-gate.js
//  Description: The password of the site, asked before anything of it on the internet (deploy/Caddyfile):
//               once given, a signed cookie keeps the browser in for 30 days after its last visit
//

"use strict"

import process from 'node:process';
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import {cookieOf} from './jwt.js';

// The password was asked by the browser (basic_auth of Caddy): an iPhone asked it again for each font
// and script of the page, 15 times, and forgot it when Safari closed. The page asks it once now, the
// cookie keeps it. Lax: a link of an e-mail or a message opens the site without asking it again
export const GATE_COOKIE = 'site_gate';
export const GATE_DAYS = 30;
// a cookie in use is renewed once a day: a reader who comes back within 30 days is never asked again
const RENEW_SECONDS = 24 * 3600;
const VERSION = 'v1';

// The key of the cookies, made from the secret of the sessions and the hash of the password: a new
// password of the site sends everyone back to the page. null without either: the gate stays shut
const gateKey = () => {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    const hash = process.env.SITE_PASSWORD_HASH;
    if (!secret || !hash) return null;
    return crypto.createHmac('sha256', secret).update(`site-gate\n${hash}`).digest();
};

const signature = (key, issuedAt) => crypto.createHmac('sha256', key).update(`${VERSION}.${issuedAt}`).digest('base64url');

// the value of a cookie given at issuedAt (seconds)
export const signGate = (issuedAt = Math.floor(Date.now() / 1000)) => {
    const key = gateKey();
    return key ? `${VERSION}.${issuedAt}.${signature(key, issuedAt)}` : null;
};

// the second the cookie was given when it is ours and less than GATE_DAYS old, else null
export const gateIssuedAt = (value, now = Date.now() / 1000) => {
    const key = gateKey();
    const [version, issued, signed] = String(value ?? '').split('.');
    const issuedAt = Number(issued);
    if (!key || version !== VERSION || !/^\d{1,12}$/.test(issued ?? '') || !signed) return null;
    const expected = Buffer.from(signature(key, issuedAt));
    const given = Buffer.from(signed);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    return issuedAt <= now + 60 && now - issuedAt < GATE_DAYS * 24 * 3600 ? issuedAt : null;
};

const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure === true,
    path: '/',
});

export const openGate = (req, res) =>
    res.cookie(GATE_COOKIE, signGate(), {...cookieOptions(req), maxAge: GATE_DAYS * 24 * 3600e3});

// the request carries a cookie of the gate still valid
export const isInside = (req) => gateIssuedAt(cookieOf(req, GATE_COOKIE)) !== null;

// on every request of the API: a cookie older than a day is given again for 30 days
export const renewGate = (req, res, next) => {
    const issuedAt = gateIssuedAt(cookieOf(req, GATE_COOKIE));
    if (issuedAt !== null && Date.now() / 1000 - issuedAt > RENEW_SECONDS) openGate(req, res);
    next();
};

// where to go once the password is given: a page of the site only, never another site ("//x.org",
// "/\x.org") nor the API
export const safeNext = (next) => {
    const path = typeof next === 'string' ? next : '';
    return /^\/(?![/\\])[^\s\\]*$/.test(path) && !path.startsWith('/api/') && path.length <= 500 ? path : '/';
};

const escape = (text) => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

// The page of the password, whole in itself: nothing else of the site is given before it (its fonts
// and its script are behind the gate too). The colours of the site, light and dark
export const gatePage = ({next = '/', error = null} = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>NewsGenerator</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
:root{--paper:#FBF9F4;--ink:#1A1815;--mute:#6B655C;--rule:#DAD3C7;--accent:#A6301F;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#17150F;--ink:#ECE7DC;--mute:#9A9384;--rule:#35312A;--accent:#E0654F;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--paper);color:var(--ink);font:17px/1.5 Georgia,"Times New Roman",serif}
main{width:100%;max-width:380px;border-top:3px double var(--ink);padding-top:20px}
h1{margin:0;font-size:2rem;font-weight:500;letter-spacing:-0.015em;line-height:1.1}
p{margin:10px 0 0;color:var(--mute)}
label{display:block;margin-top:24px;font-weight:600}
input{display:block;width:100%;margin-top:8px;padding:10px 12px;border:1px solid var(--rule);border-radius:0;background:transparent;color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{margin-top:16px;width:100%;padding:11px 12px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);font:600 1rem/1.2 Georgia,serif;cursor:pointer}
.error{color:var(--accent)}
</style>
</head>
<body>
<main>
<h1>NewsGenerator</h1>
<p>The news of the last days, chosen for one reader. The site is open to the people who have its password.</p>
<form method="post" action="/api/gate">
<input type="hidden" name="next" value="${escape(safeNext(next))}">
<label for="password">The password of the site</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="error"' : ''}>
${error ? `<p id="error" class="error" role="alert">${escape(error)}</p>\n` : ''}<button type="submit">Enter</button>
</form>
<p>Once given, this browser is not asked again for ${GATE_DAYS} days.</p>
</main>
</body>
</html>
`;
