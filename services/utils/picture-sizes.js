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

const HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; NewsGenerator/1.0; self-hosted news reader)', Accept: 'image/*'};
const TIMEOUT_MS = 6000;
const TOTAL_MS = 25000;
const CONCURRENCY = 8;
// the header of a JPEG can sit behind a long EXIF block: read until its size is found, no further
const MAX_HEADER_BYTES = 256 * 1024;

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

// {width, height} of the image at this address; null when the address answers with something that is no
// image (an error, a page, a format it can't read) so the browser would show none; undefined when it could
// not be told (too slow, the connection failed)
export const sizeOf = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        await assertPublicUrl(url);
        const response = await fetch(url, {headers: HEADERS, signal: controller.signal, redirect: 'follow'});
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
