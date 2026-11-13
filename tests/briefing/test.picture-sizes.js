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
const {dimensionsOf, forbidsEmbedding, isStanding, sizeOf, sizesOf, whyNotShown} = await import('../../services/utils/picture-sizes.js');

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

describe('isStanding', () => {
    it('should say a picture taller than wide is standing, a square or a landscape not', () => {
        expect(isStanding({width: 3333, height: 5000})).toBe(true);
        expect(isStanding({width: 864, height: 1080})).toBe(true);
        expect(isStanding({width: 1000, height: 1000})).toBe(false);
        expect(isStanding({width: 1000, height: 1050})).toBe(false);
        expect(isStanding({width: 1600, height: 900})).toBe(false);
    });

    it('should not say standing a picture of no known size', () => {
        for (const size of [undefined, null, {}, {width: 0, height: 0}, {width: 500}, {height: 500}]) expect(isStanding(size)).toBe(false);
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

    it('should give undefined, not null, for a refusal aimed at robots: the picture is not known to be dead, a browser loads it', async () => {
        // the CDN of tribuna.com, 9.11.2026: a challenge of Cloudflare for a picture a browser loads
        globalThis.fetch.mockResolvedValueOnce(answering('<html>Just a moment...</html>', {status: 403, headers: {'cf-mitigated': 'challenge', 'content-type': 'text/html'}}));
        expect(await sizeOf('https://pictures.example/challenged')).toBeUndefined();
        for (const status of [401, 403, 429]) {
            globalThis.fetch.mockResolvedValueOnce(answering('refused', {status}));
            expect(await sizeOf(`https://pictures.example/${status}`)).toBeUndefined();
        }
        // a picture that is not there, or gone, is dead
        for (const status of [404, 410]) {
            globalThis.fetch.mockResolvedValueOnce(answering('gone', {status}));
            expect(await sizeOf(`https://pictures.example/${status}`)).toBeNull();
        }
    });

    it('should give undefined when the connection failed: not told, not dead', async () => {
        globalThis.fetch.mockRejectedValue(new TypeError('fetch failed'));
        expect(await sizeOf('https://cdn.example/a.jpg')).toBeUndefined();
    });

    it('should give null for a picture its site forbids the other sites to show: a script gets it (a 200, an image), the browser of the reader blocks it', async () => {
        // editor.kosovapress.com, card 12 of the briefing of Enzo of 13.11.2026: Cross-Origin-Resource-Policy: same-site
        for (const policy of ['same-site', 'same-origin', 'Same-Site']) {
            globalThis.fetch.mockResolvedValueOnce(answering(jpeg(900, 506), {headers: {'cross-origin-resource-policy': policy, 'content-type': 'image/jpeg'}}));
            expect(await sizeOf(`https://editor.example/${policy}.jpg`)).toBeNull();
        }
        globalThis.fetch.mockResolvedValueOnce(answering(jpeg(900, 506), {headers: {'cross-origin-resource-policy': 'cross-origin'}}));
        expect(await sizeOf('https://cdn.example/open.jpg')).toEqual({width: 900, height: 506});
        globalThis.fetch.mockResolvedValueOnce(answering(jpeg(900, 506), {headers: {'content-type': 'image/jpeg'}}));
        expect(await sizeOf('https://cdn.example/none.jpg')).toEqual({width: 900, height: 506});
    });
});

describe('the redirects of a picture', () => {
    const redirect = (to, headers = {}) => new Response(null, {status: 302, headers: {location: to, ...headers}});

    it('should see the policy that forbids the other sites on the redirect, not only on the picture it leads to (editor.kosovapress.com, 13.11.2026)', async () => {
        // the address answers a 302 with Cross-Origin-Resource-Policy: same-site and sends the browser to a storage host whose picture has no such header
        globalThis.fetch.mockResolvedValueOnce(redirect('https://storage.example/2026/11/12.jpg?X-Amz=1', {'cross-origin-resource-policy': 'same-site'}));
        expect(await sizeOf('https://editor.example/api/media/12.jpg')).toBeNull();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        globalThis.fetch.mockResolvedValueOnce(redirect('https://storage.example/2026/11/12.jpg?X-Amz=1', {'cross-origin-resource-policy': 'same-site'}));
        expect(await whyNotShown('https://editor.example/api/media/12.jpg')).toBe('its site forbids the other sites to show it (Cross-Origin-Resource-Policy: same-site)');
    });

    it('should follow a redirect with no such policy to the picture, one answer at a time, each address a public one', async () => {
        globalThis.fetch.mockResolvedValueOnce(redirect('https://storage.example/a.jpg')).mockResolvedValueOnce(answering(jpeg(1200, 800)));
        expect(await sizeOf('https://cdn.example/a.jpg')).toEqual({width: 1200, height: 800});
        expect(globalThis.fetch.mock.calls.map(call => call[0])).toEqual(['https://cdn.example/a.jpg', 'https://storage.example/a.jpg']);
        expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({redirect: 'manual'});
        // a relative address, and a redirect to a private one
        globalThis.fetch.mockResolvedValueOnce(redirect('/media/b.jpg')).mockResolvedValueOnce(answering(jpeg(640, 480)));
        expect(await sizeOf('https://cdn.example/b')).toEqual({width: 640, height: 480});
        globalThis.fetch.mockResolvedValueOnce(redirect('http://private.example/inside.jpg'));
        expect(await sizeOf('https://cdn.example/c.jpg')).toBeNull();
        globalThis.fetch.mockResolvedValueOnce(redirect('http://private.example/inside.jpg'));
        expect(await whyNotShown('https://cdn.example/c.jpg')).toBe('its address is not a public one');
    });

    it('should give up on a chain that never ends', async () => {
        globalThis.fetch.mockImplementation(async () => redirect('https://cdn.example/again.jpg'));
        expect(await sizeOf('https://cdn.example/loop.jpg')).toBeNull();
        expect(await whyNotShown('https://cdn.example/loop.jpg')).toBe('the address redirects too many times');
    });
});

describe('forbidsEmbedding', () => {
    it('should name the policy that keeps the other sites from showing a picture, and nothing for the others', () => {
        const of = (policy) => forbidsEmbedding(new Response('x', {headers: policy === undefined ? {} : {'cross-origin-resource-policy': policy}}));
        expect([of('same-site'), of('same-origin'), of(' SAME-ORIGIN ')]).toEqual(['same-site', 'same-origin', 'same-origin']);
        expect([of('cross-origin'), of(''), of(undefined)]).toEqual([null, null, null]);
    });
});

describe('whyNotShown', () => {
    it('should say nothing of a picture a browser shows', async () => {
        globalThis.fetch.mockResolvedValue(answering(jpeg(1200, 800)));
        expect(await whyNotShown('https://cdn.example/a.jpg')).toBeNull();
    });

    it('should say in words why a browser would show none: a site that forbids it, an error, a page that is no image, a private address', async () => {
        globalThis.fetch.mockResolvedValueOnce(answering(jpeg(900, 506), {headers: {'cross-origin-resource-policy': 'same-site'}}));
        expect(await whyNotShown('https://editor.example/a.jpg')).toBe('its site forbids the other sites to show it (Cross-Origin-Resource-Policy: same-site)');
        globalThis.fetch.mockResolvedValueOnce(answering('gone', {status: 404}));
        expect(await whyNotShown('https://cdn.example/gone.jpg')).toBe('the address answers 404');
        globalThis.fetch.mockResolvedValueOnce(answering('<!doctype html><html><body>Not an image at all, a page</body></html>'));
        expect(await whyNotShown('https://cdn.example/page.jpg')).toBe('what the address gives is no image');
        expect(await whyNotShown('http://private.example/a.jpg')).toBe('its address is not a public one');
    });

    it('should say nothing, not that it is dead, for a refusal aimed at robots and for a connection that failed', async () => {
        globalThis.fetch.mockResolvedValueOnce(answering('<html>Just a moment...</html>', {status: 403, headers: {'cf-mitigated': 'challenge'}}));
        expect(await whyNotShown('https://pictures.example/challenged')).toBeUndefined();
        globalThis.fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
        expect(await whyNotShown('https://cdn.example/slow.jpg')).toBeUndefined();
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
