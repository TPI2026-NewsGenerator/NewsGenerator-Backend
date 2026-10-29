//
//  Author: Fabian Rostello
//  Date: 29.10.2026
//  File: test.picture-sizes.js
//  Description: The size of a picture read from its first bytes: PNG, GIF, JPEG and WebP, and what an
//               address that does not answer with an image tells
//

import {Buffer} from 'node:buffer';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../services/utils/public-url.js', () => ({
    assertPublicUrl: jest.fn(async (value) => {
        if (value.includes('private')) throw Object.assign(new Error('private'), {status: 400});
        return new URL(value);
    }),
}));
const {dimensionsOf, sizeOf, sizesOf} = await import('../../services/utils/picture-sizes.js');

const png = (width, height) => {
    const bytes = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.write('IHDR', 12, 'latin1');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
};
const gif = (width, height) => {
    const bytes = Buffer.alloc(13);
    bytes.write('GIF89a', 0, 'latin1');
    bytes.writeUInt16LE(width, 6);
    bytes.writeUInt16LE(height, 8);
    return bytes;
};
// an APP1 block (EXIF) of 40 bytes before the frame, as the cameras write it
const jpeg = (width, height) => {
    const bytes = Buffer.alloc(2 + 2 + 40 + 2 + 17);
    bytes.writeUInt16BE(0xffd8, 0);
    bytes.writeUInt16BE(0xffe1, 2);
    bytes.writeUInt16BE(40, 4);
    bytes.writeUInt16BE(0xffc0, 44);
    bytes.writeUInt16BE(17, 46);
    bytes[48] = 8;
    bytes.writeUInt16BE(height, 49);
    bytes.writeUInt16BE(width, 51);
    return bytes;
};
const riff = (kind) => {
    const bytes = Buffer.alloc(40);
    bytes.write('RIFF', 0, 'latin1');
    bytes.write('WEBP', 8, 'latin1');
    bytes.write(kind, 12, 'latin1');
    return bytes;
};
const webpLossy = (width, height) => { const bytes = riff('VP8 '); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); return bytes; };
const webpLossless = (width, height) => { const bytes = riff('VP8L'); bytes[20] = 0x2f; bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21); return bytes; };
const webpExtended = (width, height) => { const bytes = riff('VP8X'); bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); return bytes; };

const answering = (bytes, init = {}) => new Response(bytes, {status: 200, ...init});

beforeEach(() => { globalThis.fetch = jest.fn(); });

describe('dimensionsOf', () => {
    it('should read the size of a PNG, a GIF, a JPEG and the three kinds of WebP', () => {
        expect(dimensionsOf(png(1200, 675))).toEqual({width: 1200, height: 675});
        expect(dimensionsOf(gif(300, 200))).toEqual({width: 300, height: 200});
        expect(dimensionsOf(jpeg(1920, 1080))).toEqual({width: 1920, height: 1080});
        expect(dimensionsOf(webpLossy(1111, 742))).toEqual({width: 1111, height: 742});
        expect(dimensionsOf(webpLossless(640, 480))).toEqual({width: 640, height: 480});
        expect(dimensionsOf(webpExtended(1440, 810))).toEqual({width: 1440, height: 810});
    });

    it('should give none for the start of a file that does not tell it yet, or for no image', () => {
        expect(dimensionsOf(jpeg(1920, 1080).subarray(0, 30))).toBeNull();
        expect(dimensionsOf(Buffer.from('<!doctype html><html><head>'))).toBeNull();
    });
});

describe('sizeOf', () => {
    it('should give the size of an image whatever the length of the file', async () => {
        globalThis.fetch.mockResolvedValue(answering(Buffer.concat([jpeg(2000, 1500), Buffer.alloc(100000)])));
        expect(await sizeOf('https://cdn.example/a.jpg')).toEqual({width: 2000, height: 1500});
    });

    it('should give null for an error, a page or a format it cannot read, and for a private address', async () => {
        globalThis.fetch.mockResolvedValueOnce(answering('gone', {status: 404}));
        expect(await sizeOf('https://cdn.example/gone.jpg')).toBeNull();
        globalThis.fetch.mockResolvedValueOnce(answering('<!doctype html><html><body>Not an image at all, a page</body></html>'));
        expect(await sizeOf('https://cdn.example/page.jpg')).toBeNull();
        expect(await sizeOf('http://private.example/a.jpg')).toBeNull();
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should give undefined when the connection failed: not told, not dead', async () => {
        globalThis.fetch.mockRejectedValue(new TypeError('fetch failed'));
        expect(await sizeOf('https://cdn.example/a.jpg')).toBeUndefined();
    });
});

describe('sizesOf', () => {
    it('should measure each address once', async () => {
        globalThis.fetch.mockImplementation(async () => answering(png(800, 450)));
        const sizes = await sizesOf(['https://a.example/1.png', 'https://a.example/1.png', 'https://a.example/2.png']);
        expect(sizes.get('https://a.example/1.png')).toEqual({width: 800, height: 450});
        expect(sizes.size).toBe(2);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
});
