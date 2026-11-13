//
//  Author: Fabian Rostello
//  Date: 29.10.2026
//  File: picture-sizes.js
//  Description: The size of the pictures of a card's articles, read from the first bytes of each file, to
//               show the sharpest one and to know which ones do not load at all
//

"use strict"

import {Buffer} from "node:buffer";
import {mapWithConcurrency} from "./concurrency.js";
import {assertPublicUrl} from "./public-url.js";

// Wide enough for the card and the e-mail, which shows 560 px (see briefing-mail.js)
export const SHARP_WIDTH = 560;
// the app says what it is to the sites it reads: it never passes for a browser (see ROBOT_REFUSALS)
export const PICTURE_HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; self-hosted news reader)', Accept: 'image/*'};
const HEADERS = PICTURE_HEADERS;
const TIMEOUT_MS = 6000;
const TOTAL_MS = 25000;
const CONCURRENCY = 8;
// the header of a JPEG can sit behind a long EXIF block: read until its size is found, no further
const MAX_HEADER_BYTES = 256 * 1024;

// A picture taller than wide (a portrait: 2:3, 3:4), known by its size {width, height}: the card shows it cut to a landscape, the e-mail no higher than a
// landscape (see briefing-mail.js). A picture of unknown size is not said standing
export const STANDING_RATIO = 0.9;
export const isStanding = (size) => Boolean(size?.width > 0 && size?.height > 0) && size.width / size.height < STANDING_RATIO;

// {width, height} of an image from its first bytes (PNG, GIF, JPEG, WebP), null while they don't tell it
export const dimensionsOf = (bytes) => {
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
        return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
    }
    if (bytes.length >= 10 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') {
        return {width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8)};
    }
    if (bytes.length >= 30 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
        const kind = bytes.subarray(12, 16).toString('latin1');
        if (kind === 'VP8 ') return {width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff};
        if (kind === 'VP8L') {
            const bits = bytes.readUInt32LE(21);
            return {width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff)};
        }
        if (kind === 'VP8X') return {width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3)};
        return null;
    }
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let at = 2;
        while (at + 9 < bytes.length) {
            if (bytes[at] !== 0xff) { at++; continue; }
            const marker = bytes[at + 1];
            if (marker === 0xff) { at++; continue; }
            // SOF0..SOF15 but DHT (C4), JPG (C8) and DAC (CC) hold the size
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return {width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5)};
            }
            at += marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + bytes.readUInt16BE(at + 2);
        }
    }
    return null;
};

const isImage = (bytes) => bytes.length >= 4 && (bytes.readUInt32BE(0) === 0x89504e47 || bytes.subarray(0, 4).toString('latin1') === 'GIF8'
    || (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.length >= 12 && bytes.subarray(8, 12).toString('latin1') === 'WEBP'));

// A refusal aimed at robots tells nothing of the picture: the CDN of tribuna.com answers a script with a challenge of Cloudflare (403,
// cf-mitigated: challenge) for a picture that a browser loads (1920×1080), and the card of the briefing of Enzo of 9.11.2026 lost the one
// picture it had. The page of the reader is a browser, which loads it or, if it cannot, hides it (onError of the card). The app does not try to
// get past the wall: it does not know, and says so
const ROBOT_REFUSALS = new Set([401, 403, 429]);

// A site can forbid the others to show its pictures: Cross-Origin-Resource-Policy: same-origin or same-site. A script fetches such a picture all the same (a 200, an image), but the
// browser on the page of the reader BLOCKS it, and the card shows none. Found on the card 12 of the briefing of Enzo of 13.11.2026 (editor.kosovapress.com, same-site): 1 of the 55
// pictures of the three briefings of the day. The picture is then one a browser would show none of (null in sizeOf, a reason in whyNotShown)
export const forbidsEmbedding = (response) => {
    const policy = String(response.headers.get('cross-origin-resource-policy') ?? '').trim().toLowerCase();
    return ['same-origin', 'same-site'].includes(policy) ? policy : null;
};

// The picture at this address, the redirects followed ONE BY ONE: {response, policy}, policy the Cross-Origin-Resource-Policy that forbids the other sites to show it, on ANY answer of
// the chain, not only the last: a browser checks every one. The address of editor.kosovapress.com answers a 302 with "same-site" and sends the browser to a storage host whose picture has
// no such header: followed by fetch itself the picture looked fine, and the card of Enzo of 13.11.2026 showed none. response is null for a chain too long (more than 5 redirects). Every address
// of the chain is checked to be a public one
const MAX_REDIRECTS = 5;
const pictureChain = async (url, signal) => {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertPublicUrl(current);
        const response = await fetch(current, {headers: HEADERS, signal, redirect: 'manual'});
        const policy = forbidsEmbedding(response);
        if (policy) return {response, policy};
        const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (!location) return {response, policy: null};
        await response.body?.cancel();
        current = new URL(location, current).href;
    }
    return {response: null, policy: null};
};

// {width, height} of the image at this address; null when the address answers with something that is no
// image (an error, a page, a format it can't read) so the browser would show none; undefined when it could
// not be told (too slow, the connection failed, a refusal aimed at robots)
export const sizeOf = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const {response, policy} = await pictureChain(url, controller.signal);
        if (policy || !response) {
            await response?.body?.cancel();
            return null;
        }
        if (!response.ok && (ROBOT_REFUSALS.has(response.status) || response.headers.get('cf-mitigated'))) {
            await response.body?.cancel();
            return undefined;
        }
        if (!response.ok || !response.body) return null;
        let bytes = Buffer.alloc(0);
        for await (const chunk of response.body) {
            bytes = Buffer.concat([bytes, chunk]);
            const size = dimensionsOf(bytes);
            if (size) return size.width > 0 && size.height > 0 ? size : null;
            if (bytes.length >= 32 && !isImage(bytes)) return null;
            if (bytes.length >= MAX_HEADER_BYTES) return null;
        }
        return null;
    } catch (err) {
        return err?.status === 400 ? null : undefined;
    } finally {
        clearTimeout(timer);
    }
};

// Why a browser on the page of a reader would show NONE of the picture at this address, in words; null when it would show it; undefined when it could not be told (too slow, the connection
// failed, a refusal aimed at robots). The same reading as sizeOf, for the audit of a briefing already written (briefing-checks.js)
export const whyNotShown = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const {response, policy} = await pictureChain(url, controller.signal);
        if (policy) {
            await response.body?.cancel();
            return `its site forbids the other sites to show it (Cross-Origin-Resource-Policy: ${policy})`;
        }
        if (!response) return 'the address redirects too many times';
        if (!response.ok && (ROBOT_REFUSALS.has(response.status) || response.headers.get('cf-mitigated'))) {
            await response.body?.cancel();
            return undefined;
        }
        if (!response.ok) {
            await response.body?.cancel();
            return `the address answers ${response.status}`;
        }
        let bytes = Buffer.alloc(0);
        for await (const chunk of response.body ?? []) {
            bytes = Buffer.concat([bytes, chunk]);
            if (bytes.length >= 32) break;
        }
        await response.body?.cancel().catch(() => {});
        return isImage(bytes) ? null : 'what the address gives is no image';
    } catch (err) {
        return err?.status === 400 ? 'its address is not a public one' : undefined;
    } finally {
        clearTimeout(timer);
    }
};

// Map url -> {width, height} | null | undefined (see sizeOf) for these addresses, each once; the ones not
// told within TOTAL_MS are left undefined: a card then keeps the order of its articles
export const sizesOf = async (urls) => {
    const sizes = new Map();
    const deadline = Date.now() + TOTAL_MS;
    const unique = [...new Set(urls)];
    await mapWithConcurrency(unique, CONCURRENCY, async (url) => {
        if (Date.now() < deadline) sizes.set(url, await sizeOf(url));
    });
    return sizes;
};
