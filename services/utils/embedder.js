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
// The embedders to use: EMBEDDER_URL lists them, separated by commas ("http://server:8020,
// http://gaming-pc:8020"), and every one that answers works at the same time (see embed). The vectors
// are the same everywhere (bge-m3 in fp32, cosine 1.000000 between a graphics card and a processor),
// only the speed changes: 57 texts a second on an RTX 4070 Ti, 2.6 on the 6 cores of an i5-12400T. A
// machine switched on joins within RECHECK_MS, one switched off is left as soon as it fails a request.
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
// An embedder off (or never asked) is asked again this often: a machine switched on joins the work
const RECHECK_MS = 60 * 1000;
const CLOSED = new Set(['UND_ERR_SOCKET', 'ECONNRESET']);     // the connection closed, not refused nor too slow
// texts a second guessed before an embedder answered a request (see above), then measured
const GUESSED_RATE = {cpu: 2.5, other: 50};
const RATE_KEPT = 0.7;                  // the share of the last rate kept at each request answered
export const DIMENSIONS = 1024;

// What this process knows of each embedder, by address: {up, batch, rate (texts a second), queued
// (texts sent or waiting to be), checkedAt, queue}
const embedders = new Map();
let lastUp = '';

const stateOf = (url) => {
    if (!embedders.has(url)) embedders.set(url, {up: false, batch: BATCH(), rate: GUESSED_RATE.other, queued: 0, checkedAt: 0, queue: Promise.resolve()});
    return embedders.get(url);
};

// One request at a time from this process to each embedder. An embedder encodes one batch at a time
// anyway, so requests sent together only wait there, and fetch gives up after 300 s without an answer
// (UND_ERR_HEADERS_TIMEOUT, whatever the signal says): the discovery judging twenty feeds at once
// while the ingestion embedded lost both its feeds and the batch of the ingestion.
//
// A text cut in the middle of a character (a description cut at 400 units inside an emoji) holds
// half of it, which the tokenizer of the embedder refuses: it dropped the connection, the batch failed
// on every embedder, and each run of the ingestion stopped on the same news, leaving the older ones
// without vectors (1.10.2026, one news of 8905). The half is sent as the replacement character
const post = (url, batch) => {
    const state = stateOf(url);
    state.queued += batch.length;
    const request = state.queue.then(async () => {
        const started = Date.now();
        const res = await fetch(`${url}/embed`, {
            method: 'POST',
            headers: HEADERS(),
            body: JSON.stringify({texts: batch.map(text => text.toWellFormed())}),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = res.ok ? await res.json() : null;
        // its speed as measured, the wait behind the other requests of this process left out
        if (res.ok) state.rate = RATE_KEPT * state.rate + (1 - RATE_KEPT) * batch.length / Math.max(0.05, (Date.now() - started) / 1000);
        return {ok: res.ok, status: res.status, body};
    }).finally(() => { state.queued -= batch.length; });
    state.queue = request.catch(() => {});
    return request;
};

// asks an embedder whether it answers, and what it runs on. An embedder older than the "device" of
// its answer is taken as it was configured, with EMBEDDER_BATCH
const check = (url) => {
    const state = stateOf(url);
    // a call asking while another one checks waits for the same answer
    if (state.checking) return state.checking;
    state.checkedAt = Date.now();
    state.checking = health(state, url).finally(() => { state.checking = null; });
    return state.checking;
};

const health = async (state, url) => {
    try {
        const res = await fetch(`${url}/health`, {signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const {device} = await res.json().catch(() => ({}));
        const cpu = device === 'cpu';
        // a machine coming back starts from the guess of its kind
        if (!state.up) state.rate = cpu ? GUESSED_RATE.cpu : GUESSED_RATE.other;
        Object.assign(state, {up: true, batch: cpu ? CPU_BATCH : BATCH(), cpu});
    } catch {
        state.up = false;
    }
};

// the embedders that answer, in the order of the list. The ones off (or never asked) are asked
// together, at most every RECHECK_MS each: one off costs HEALTH_TIMEOUT_MS a minute, not a request
const available = async () => {
    const urls = URLS();
    await Promise.all(urls.filter(url => !stateOf(url).up && (stateOf(url).checking || Date.now() - stateOf(url).checkedAt >= RECHECK_MS)).map(check));
    const up = urls.filter(url => stateOf(url).up);
    const told = up.map(url => `${url} (${stateOf(url).cpu ? 'processor' : 'graphics card'})`).join(', ');
    if (told !== lastUp && urls.length > 1) console.log(`Embedders: ${told || 'none answers'}`);
    lastUp = told;
    return up;
};

// an embedder that failed a request is asked its health again by the next call: switched off, it then
// waits RECHECK_MS; still answering (a connection reset), it works again
const leave = (url) => Object.assign(stateOf(url), {up: false, checkedAt: 0});

const notAnswering = (detail) => Object.assign(
    new Error(`The embedder does not answer at ${URLS().join(' nor at ')}${detail ? ` (${detail})` : ''}. Start it with "pnpm run embedder".`),
    {status: 503});

// The vectors of these texts, in the same order: [{dense: Float32Array, sparse: {token: weight}}].
// Every embedder that answers takes batches of them at the same time, as long as it is worth it: one
// takes the next batch only when it would finish it before the others finish all that is left (what
// they are encoding included). A processor next to a graphics card 20 times faster would only make
// the call wait for its last batch; two processors, or a processor next to a graphics card busy with
// another call, share the work. An embedder that stops answering hands its batch to the others
export const embed = async (texts) => {
    const vectors = new Array(texts.length);
    let left = [[0, texts.length]];         // the places of the texts not encoded yet
    const count = () => left.reduce((sum, [start, end]) => sum + end - start, 0);
    const take = (size) => {
        const [start, end] = left[0];
        const until = Math.min(end, start + size);
        left = until === end ? left.slice(1) : [[until, end], ...left.slice(1)];
        return [start, until];
    };
    // a batch not encoded goes back to its place, joined to the texts next to it
    const giveBack = (range) => {
        left = [...left, range].sort((a, b) => a[0] - b[0])
            .reduce((joined, next) => joined.length > 0 && joined.at(-1)[1] === next[0]
                ? [...joined.slice(0, -1), [joined.at(-1)[0], next[1]]] : [...joined, next], []);
    };
    // The embedders that failed a request of this call are skipped for its rest: the graphics card
    // reset a connection twice on 1.10 while still answering to its health, was chosen again and
    // failed again, and the processor next to it was never asked
    const failed = new Set();
    // A connection closed by the other side between two batches (UND_ERR_SOCKET) is no embedder off:
    // it happened every few runs with the graphics card, which answered the next request. That one
    // is asked again once before it is left
    const retried = new Set();
    let refused = null;
    let reason = null;

    // its next batch done before the others are done with all that is left, or before any of them
    // would have done this batch (the last one: the fastest takes it)
    const worthIt = (url, team) => {
        const self = stateOf(url);
        const others = team.filter(other => other !== url && !failed.has(other)).map(stateOf);
        if (others.length === 0) return true;
        const size = Math.min(self.batch, left[0][1] - left[0][0]);
        const rate = others.reduce((sum, other) => sum + other.rate, 0);
        const queued = others.reduce((sum, other) => sum + other.queued, 0);
        const alone = Math.min(...others.map(other => (other.queued + size) / other.rate));
        return (self.queued + size) / self.rate <= Math.max(alone, (queued + count()) / rate);
    };

    const work = async (url, team) => {
        while (left.length > 0 && !refused && !failed.has(url) && worthIt(url, team)) {
            const [start, end] = take(stateOf(url).batch);
            const batch = texts.slice(start, end);
            let res;
            try {
                res = await post(url, batch);
            } catch (err) {
                giveBack([start, end]);
                // "fetch failed" alone does not say whether it was refused, reset or too slow
                reason = `${url}: ${[err.message, err.cause?.code ?? err.cause?.message].filter(Boolean).join(': ')}`;
                if (CLOSED.has(err.cause?.code) && !retried.has(url)) {
                    retried.add(url);
                    console.log(`Embedder: ${reason}, the connection closed, asked again`);
                    continue;
                }
                failed.add(url);
                leave(url);
                console.log(`Embedder: ${reason}, left`);
                return;
            }
            if (res.status === 401) refused ??= Object.assign(new Error(`The embedder at ${url} refused the token: EMBEDDER_TOKEN must be the same on both sides.`), {status: 502});
            else if (!res.ok) refused ??= Object.assign(new Error(`The embedder failed: HTTP ${res.status}`), {status: 502});
            if (refused) return;
            const {dense, sparse} = res.body;
            batch.forEach((_, j) => { vectors[start + j] = {dense: Float32Array.from(dense[j]), sparse: sparse[j] ?? {}}; });
        }
    };

    // the batches of one that failed go to the others still there
    while (left.length > 0) {
        const team = (await available()).filter(url => !failed.has(url));
        if (team.length === 0) throw notAnswering(reason);
        await Promise.all(team.map(url => work(url, team)));
        if (refused) throw refused;
    }
    return vectors;
};

// is an embedder running, without waiting long for it
export const embedderIsUp = async () => (await available()).length > 0;

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
