//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: tagger.js
//  Description: The taggers (ner/server.py): where they answer, what they run on, and the names they
//               find in texts
//

"use strict"

import process from 'node:process'

// NER_URL lists them, separated by commas ("http://gaming-pc:8021,http://server:8021"): each one that
// answers takes its own news (see tagging-service.js). None: the news are not tagged
export const taggerUrls = () => (process.env.NER_URL ?? '')
    .split(',').map(url => url.trim().replace(/\/+$/, '')).filter(Boolean);

// the secret of the taggers, the one of the embedders when they share it
const HEADERS = () => {
    const token = process.env.NER_TOKEN || process.env.EMBEDDER_TOKEN;
    return {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})};
};
const HEALTH_TIMEOUT_MS = 2000;
// a batch of the processor takes 8 s, 40 when the machine is busy: fetch gives up at 300 s anyway
const TIMEOUT_MS = 280 * 1000;

// 'cpu' or 'cuda' when the tagger answers, null when it does not
export const taggerDevice = async (url) => {
    try {
        const res = await fetch(`${url}/health`, {signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)});
        if (!res.ok) return null;
        const {device} = await res.json().catch(() => ({}));
        return device === 'cuda' ? 'cuda' : 'cpu';
    } catch {
        return null;
    }
};

// [[{text, label, score}]]: the names of each text, in the same order. A text cut inside a character
// (a description cut inside an emoji) is sent with the replacement character
export const tagTexts = async (url, texts) => {
    const res = await fetch(`${url}/entities`, {
        method: 'POST',
        headers: HEADERS(),
        body: JSON.stringify({texts: texts.map(text => text.toWellFormed())}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw Object.assign(new Error(`The tagger at ${url} refused the token: NER_TOKEN must be the same on both sides.`), {status: 502});
    if (!res.ok) throw Object.assign(new Error(`The tagger at ${url} failed: HTTP ${res.status}`), {status: 502});
    const {entities} = await res.json();
    if (!Array.isArray(entities) || entities.length !== texts.length) throw Object.assign(new Error(`The tagger at ${url} answered no list of names.`), {status: 502});
    return entities;
};
