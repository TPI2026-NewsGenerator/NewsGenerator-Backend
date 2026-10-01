//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: embedder.js
//  Description: bge-m3 vectors of texts (see embedder/server.py) and how close two of them are
//

"use strict"

import process from 'node:process'

// A text gets two vectors from bge-m3:
//  - dense: 1024 numbers for its meaning, normalized, so their dot product is their cosine
//  - sparse: a weight for each word it contains ({"token id": weight}), the names weigh the most
// Measured on the stories judged by hand, the best similarity is dense + sparse: the dense finds two
// titles saying the same thing in other words, the sparse keeps apart two templates sharing none of
// their names. They are stored and compared by pgvector (see db/add_briefing.sql).
// The embedders to use, the first that answers: EMBEDDER_URL lists them, in order, separated by commas
// ("http://gaming-pc:8020,http://server:8020"). The vectors are the same everywhere (bge-m3 in fp32,
// cosine 1.000000 between a graphics card and a processor), only the speed changes: 57 texts a second
// on an RTX 4070 Ti, 2.6 on the 6 cores of an i5-12400T. A machine that is not always on goes first,
// one that is goes after it and takes over while the first is off.
const URLS = () => (process.env.EMBEDDER_URL ?? 'http://127.0.0.1:8020')
    .split(',').map(url => url.trim().replace(/\/+$/, '')).filter(Boolean);
// the secret the embedder asks for when it runs on another machine (its EMBEDDER_TOKEN)
const HEADERS = () => ({
    'Content-Type': 'application/json',
    ...(process.env.EMBEDDER_TOKEN ? {Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`} : {}),
});
// Texts per request. fetch gives up after 300 s without an answer whatever TIMEOUT_MS says, and on a
// busy processor 64 texts took up to 310 s: a batch must stay short enough to wait behind the one of
// another process (the server and "pnpm run ingest") and still be answered in time. A graphics card
// answers 16 texts in a fraction of a second, EMBEDDER_BATCH=128 there saves the round trips. An
// embedder saying it runs on a processor always gets CPU_BATCH: a search would wait behind 128 texts
// for about 50 s.
const BATCH = () => Number(process.env.EMBEDDER_BATCH) || 16;
const CPU_BATCH = 16;
const TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 2000;
// While another one than the first works, the ones before it are asked again this often: a machine
// switched on again takes back the work
const RECHECK_MS = 60 * 1000;
const CLOSED = new Set(['UND_ERR_SOCKET', 'ECONNRESET']);     // the connection closed, not refused nor too slow
export const DIMENSIONS = 1024;

// One request at a time from this process. The embedder encodes one batch at a time anyway, so
// requests sent together only wait there, and fetch gives up after 300 s without an answer
// (UND_ERR_HEADERS_TIMEOUT, whatever the signal says): the discovery judging twenty feeds at once
// while the ingestion embedded lost both its feeds and the batch of the ingestion.
let queue = Promise.resolve();

const post = (url, batch) => {
    const request = queue.then(() => fetch(`${url}/embed`, {
        method: 'POST',
        headers: HEADERS(),
        body: JSON.stringify({texts: batch}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(async res => ({ok: res.ok, status: res.status, body: res.ok ? await res.json() : null})));
    queue = request.catch(() => {});
    return request;
};

// {url, batch, at} when this embedder answers, null otherwise. An embedder older than the "device" of
// its answer is taken as it was configured, with EMBEDDER_BATCH
const health = async (url) => {
    try {
        const res = await fetch(`${url}/health`, {signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)});
        if (!res.ok) return null;
        const {device} = await res.json().catch(() => ({}));
        return {url, batch: device === 'cpu' ? CPU_BATCH : BATCH(), at: Date.now()};
    } catch {
        return null;
    }
};

// the embedder in use: the first of the list kept as long as it answers, another one for RECHECK_MS
let chosen = null;

// the first embedder of the list that answers, null when none does. 'skip': the ones that just failed
// a request, even if they still answer to their health
const choose = async (skip = new Set()) => {
    const urls = URLS();
    if (chosen && urls.includes(chosen.url) && !skip.has(chosen.url)
        && (chosen.url === urls[0] || Date.now() - chosen.at < RECHECK_MS)) return chosen;
    for (const url of urls) {
        if (skip.has(url)) continue;
        const up = await health(url);
        if (up) {
            if (chosen?.url !== url && urls.length > 1) console.log(`Embedder: ${url} (${up.batch === CPU_BATCH ? 'processor' : 'graphics card'})`);
            chosen = up;
            return chosen;
        }
    }
    chosen = null;
    return null;
};

const notAnswering = (detail) => Object.assign(
    new Error(`The embedder does not answer at ${URLS().join(' nor at ')}${detail ? ` (${detail})` : ''}. Start it with "pnpm run embedder".`),
    {status: 503});

// the vectors of these texts, in the same order: [{dense: Float32Array, sparse: {token: weight}}]. An
// embedder that stops answering in the middle hands the rest to the next one of the list
export const embed = async (texts) => {
    const vectors = [];

    // The embedders that failed a request of this call are skipped for its rest: the graphics card
    // reset a connection twice on 1.10 while still answering to its health, was chosen again and
    // failed again, and the processor next to it was never asked
    const failed = new Set();
    // A connection closed by the other side between two batches (UND_ERR_SOCKET) is no embedder off:
    // it happened every few runs with the graphics card, which answered the next request. That one
    // is asked again once before the next one is
    const retried = new Set();
    for (let i = 0; i < texts.length;) {
        const target = await choose(failed);
        if (!target) throw notAnswering();

        const batch = texts.slice(i, i + target.batch);
        let res;
        try {
            res = await post(target.url, batch);
        } catch (err) {
            // "fetch failed" alone does not say whether it was refused, reset or too slow
            const reason = [err.message, err.cause?.code ?? err.cause?.message].filter(Boolean).join(': ');
            if (CLOSED.has(err.cause?.code) && !retried.has(target.url)) {
                retried.add(target.url);
                console.log(`Embedder: ${target.url} closed the connection (${reason}), asked again`);
                continue;
            }
            // the list is asked again without it: the next one keeps the work for RECHECK_MS
            chosen = null;
            failed.add(target.url);
            if (failed.size < URLS().length) {
                console.log(`Embedder: ${target.url} did not answer (${reason})`);
                continue;
            }
            throw notAnswering(`${target.url}: ${reason}`);
        }
        if (res.status === 401) throw Object.assign(new Error(`The embedder at ${target.url} refused the token: EMBEDDER_TOKEN must be the same on both sides.`), {status: 502});
        if (!res.ok) throw Object.assign(new Error(`The embedder failed: HTTP ${res.status}`), {status: 502});

        const {dense, sparse} = res.body;
        batch.forEach((_, j) => vectors.push({dense: Float32Array.from(dense[j]), sparse: sparse[j] ?? {}}));
        i += batch.length;
    }

    return vectors;
};

// is an embedder running, without waiting long for it
export const embedderIsUp = async () => (await choose()) !== null;

// cosine of two dense vectors (both normalized by bge-m3), for the texts that are not stored
// (the stored ones are compared by pgvector, see db/add_briefing.sql)
export const denseSimilarity = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
};

// The vectors as pgvector reads them, sent as text and cast in SQL (Prisma has no type for them):
//  vector(1024): "[0.012,-0.034,...]"
//  sparsevec(250002): "{5:0.21,1024:0.08}/250002", the token ids of bge-m3 counted from 1, in order
export const SPARSE_DIMENSIONS = 250002;        // the vocabulary of bge-m3

export const toVector = (dense) => `[${Array.from(dense).join(',')}]`;

export const toSparsevec = (sparse) => {
    const entries = Object.entries(sparse ?? {})
        .map(([token, weight]) => [Number(token) + 1, weight])
        .filter(([index, weight]) => Number.isInteger(index) && index >= 1 && index <= SPARSE_DIMENSIONS && weight !== 0)
        .sort((a, b) => a[0] - b[0]);
    return `{${entries.map(([index, weight]) => `${index}:${weight}`).join(',')}}/${SPARSE_DIMENSIONS}`;
};

// a vector read back as text ("[0.1,0.2]"), for the few that are compared here
export const parseVector = (text) => Float32Array.from(JSON.parse(text));
