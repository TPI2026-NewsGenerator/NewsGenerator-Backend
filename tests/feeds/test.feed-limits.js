//
//  Author: Fabian Rostello
//  Date: 25.09.2026
//  File: test.feed-limits.js
//  Description: Tests for the limits of the sources of a reader, and the addresses that stay private
//

import {afterAll, beforeAll, describe, expect, it} from '@jest/globals';
import {bridgeRoom, looksPrivate, MAX_BRIDGE_FEEDS, withinBridgeRoom} from '../../services/utils/feed-limits.js';

const BRIDGE = 'http://127.0.0.1:3002';
const bridged = (site) => `${BRIDGE}/?action=display&bridge=CssSelectorBridge&home_page=${encodeURIComponent(`https://${site}/`)}`;

let previous;
beforeAll(() => {
    previous = process.env.RSS_BRIDGE_URL;
    process.env.RSS_BRIDGE_URL = BRIDGE;
});
afterAll(() => {
    if (previous === undefined) delete process.env.RSS_BRIDGE_URL;
    else process.env.RSS_BRIDGE_URL = previous;
});

describe('looksPrivate', () => {
    it('should let the address of a public feed be shared', () => {
        for (const url of [
            'https://rss.tribuna.com/en/feed.xml',
            'http://www.footmercato.net/flux-rss',
            'https://www.lemonde.fr/football/rss_full.xml',
            'https://news.google.com/rss/search?q=uefa&hl=fr&gl=FR',
            'https://www.si.com/soccer/transfer-news-2026-summer-window/feed',
            bridged('goal.com'),
        ]) {
            expect([url, looksPrivate(url)]).toEqual([url, false]);
        }
    });

    it('should keep private an address holding a key of its reader', () => {
        for (const url of [
            'https://www.patreon.com/rss/somecreator?auth=Xk29fLq0aZ81mTTr4pQw',
            'https://example.substack.com/feed?token=abc',
            'https://feeds.example.com/private/3f2b9c1e-8a4d-4f6b-9c2e-7d1a5b8e0f34.xml',
            'https://podcasts.example.com/feed/a8F3kLq92ZxW7mNp4Rt6Yv1B/rss',
            'https://user:secret@example.com/feed',
            'not an url',
        ]) {
            expect([url, looksPrivate(url)]).toEqual([url, true]);
        }
    });
});

describe('bridge room', () => {
    it('should count only the feeds read through the bridge', () => {
        expect(bridgeRoom(['https://a.com/rss', bridged('goal.com')])).toBe(MAX_BRIDGE_FEEDS - 1);
        expect(bridgeRoom(Array.from({length: MAX_BRIDGE_FEEDS + 2}, (_, i) => bridged(`s${i}.com`)))).toBe(0);
    });

    it('should drop the feeds of the bridge once there is no room, and keep the others in order', () => {
        const feeds = [{url: bridged('a.com')}, {url: 'https://b.com/rss'}, {url: bridged('c.com')}, {url: 'https://d.com/rss'}];
        expect(withinBridgeRoom(feeds, 1).map(feed => feed.url)).toEqual([bridged('a.com'), 'https://b.com/rss', 'https://d.com/rss']);
    });
});
