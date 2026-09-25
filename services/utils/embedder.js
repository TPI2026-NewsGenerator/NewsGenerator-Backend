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
const EMBEDDER_URL = () => process.env.EMBEDDER_URL ?? 'http://127.0.0.1:8020';
// the secret the embedder asks for when it runs on another machine (its EMBEDDER_TOKEN)
const HEADERS = () => ({
    'Content-Type': 'application/json',
    ...(process.env.EMBEDDER_TOKEN ? {Authorization: `Bearer ${process.env.EMBEDDER_TOKEN}`} : {}),
});
// Texts per request. fetch gives up after 300 s without an answer whatever TIMEOUT_MS says, and on a
// busy processor 64 texts took up to 310 s: a batch must stay short enough to wait behind the one of
// another process (the server and "pnpm run ingest") and still be answered in time. A graphics card
// answers 16 texts in a fraction of a second, EMBEDDER_BATCH=128 there saves the round trips.
const BATCH = () => Number(process.env.EMBEDDER_BATCH) || 16;
const TIMEOUT_MS = 10 * 60 * 1000;
export const DIMENSIONS = 1024;

// One request at a time from this process. The embedder encodes one batch at a time anyway, so
// requests sent together only wait there, and fetch gives up after 300 s without an answer
// (UND_ERR_HEADERS_TIMEOUT, whatever the signal says): the discovery judging twenty feeds at once
// while the ingestion embedded lost both its feeds and the batch of the ingestion.
let queue = Promise.resolve();

const post = (batch) => {
    const request = queue.then(() => fetch(`${EMBEDDER_URL()}/embed`, {
        method: 'POST',
        headers: HEADERS(),
        body: JSON.stringify({texts: batch}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    }).then(async res => ({ok: res.ok, status: res.status, body: res.ok ? await res.json() : null})));
    queue = request.catch(() => {});
    return request;
};

// the vectors of these texts, in the same order: [{dense: Float32Array, sparse: {token: weight}}]
export const embed = async (texts) => {
    const vectors = [];

    const size = BATCH();
    for (let i = 0; i < texts.length; i += size) {
        const batch = texts.slice(i, i + size);
        let res;
        try {
            res = await post(batch);
        } catch (err) {
            // "fetch failed" alone does not say whether it was refused, reset or too slow
            const reason = [err.message, err.cause?.code ?? err.cause?.message].filter(Boolean).join(': ');
            throw Object.assign(new Error(`The embedder does not answer at ${EMBEDDER_URL()} (${reason}). Start it with "pnpm run embedder".`), {status: 503});
        }
        if (res.status === 401) throw Object.assign(new Error(`The embedder at ${EMBEDDER_URL()} refused the token: EMBEDDER_TOKEN must be the same on both sides.`), {status: 502});
        if (!res.ok) throw Object.assign(new Error(`The embedder failed: HTTP ${res.status}`), {status: 502});

        const {dense, sparse} = res.body;
        batch.forEach((_, j) => vectors.push({dense: Float32Array.from(dense[j]), sparse: sparse[j] ?? {}}));
    }

    return vectors;
};

// is the embedder running, without waiting for it
export const embedderIsUp = async () => {
    try {
        const res = await fetch(`${EMBEDDER_URL()}/health`, {signal: AbortSignal.timeout(2000)});
        return res.ok;
    } catch {
        return false;
    }
};

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
