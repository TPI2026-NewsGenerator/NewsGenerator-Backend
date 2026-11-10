//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: api-key.js
//  Description: The keys of the systems that read our data through /api/v1 (the map of a friend): a key is made
//               once by scripts/make-api-key.js and sent to its owner, the server keeps only its SHA-256 in
//               API_KEYS (api.env), so a leak of the file gives no key. Read-only routes, one key a client
//

"use strict"

import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';

export const KEY_PREFIX = 'fiq_';

// 32 random bytes (256 bits) in base64url, 47 characters with the prefix. The prefix only tells whose it is in a
// log or a scanner of secrets, it adds nothing to the strength
export const newApiKey = () => KEY_PREFIX + crypto.randomBytes(32).toString('base64url');

// A key this long and this random needs no slow hash (bcrypt is for what a person chose): one SHA-256 is enough
export const hashOfKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

// API_KEYS="footballiq:<sha256>,other:<sha256>" -> [{name, hash}]. An entry that is not a name and 64
// hexadecimal characters is left out: a typo never opens anything
export const clientsOfEnv = (value = process.env.API_KEYS) => String(value ?? '').split(',').map(entry => entry.trim()).filter(Boolean).flatMap(entry => {
    const at = entry.indexOf(':');
    const name = entry.slice(0, at).trim();
    const hash = entry.slice(at + 1).trim().toLowerCase();
    return at > 0 && /^[a-z0-9_-]{1,40}$/i.test(name) && /^[0-9a-f]{64}$/.test(hash) ? [{name, hash}] : [];
});

// the name of the client whose key this is, null for none. Every hash is compared, in constant time: how long
// it takes tells nothing of how close the key was
export const clientOfKey = (key, clients = clientsOfEnv()) => {
    const given = Buffer.from(hashOfKey(key), 'hex');
    let found = null;
    for (const client of clients) {
        if (crypto.timingSafeEqual(given, Buffer.from(client.hash, 'hex')) && found === null) found = client.name;
    }
    return found;
};

// the errors of /api/v1: {error: {code, message}}, the code is for the program of the client, the message for whoever reads the log
export const apiError = (res, status, code, message, more = {}) => res.status(status).json({error: {code, message, ...more}});

// Authorization: Bearer <key>. API_KEYS is read at each request: a key added is taken when the server restarts, as
// any other line of api.env, and none set means no key opens anything
export const apiKey = (req, res, next) => {
    const [scheme, key, ...rest] = (req.get('Authorization') ?? '').trim().split(/\s+/);
    const client = scheme?.toLowerCase() === 'bearer' && key && rest.length === 0 ? clientOfKey(key) : null;
    if (client === null) {
        res.set('WWW-Authenticate', 'Bearer realm="NewsGenerator"');
        return apiError(res, 401, 'unauthorized', 'A valid key is needed: Authorization: Bearer <key>.');
    }
    req.apiClient = client;
    next();
};
