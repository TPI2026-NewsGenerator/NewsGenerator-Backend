//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.feed-finder-dead.js
//  Description: A feed named by a list that died since: the root of its site is tried instead
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const FEED = 'https://www.club.example/news/feed.xml';
// the root declares its feed, every other page is gone
const fetchPublicUrl = jest.fn(async (url) => url === 'https://www.club.example/'
    ? {res: {ok: true, text: async () => `<html><head><link rel="alternate" type="application/rss+xml" href="${FEED}"></head></html>`}, url}
    : {res: {ok: false, status: 404}, url});

jest.unstable_mockModule('../../services/utils/public-url.js', () => ({
    assertPublicUrl: async (value) => new URL(value),
    fetchPublicUrl,
    discardBody: async () => {},
    readText: async (res) => res.text(),
    hostOf: (value) => {
        try {
            return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    },
    isBridgeUrl: () => false,
    nameOf: (host) => host.split('.').slice(-2)[0],
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({
    Crawlers: {
        Xml: jest.fn(async (feeds) => feeds.map(({url}) => ({url, items: url === FEED
            ? [{title: 'A news of the club', link: 'https://www.club.example/news/1', pubDate: new Date().toUTCString()}]
            : []}))),
    },
}));
jest.unstable_mockModule('../../services/utils/feed-directory.js', () => ({searchDirectory: jest.fn(async () => [])}));
jest.unstable_mockModule('../../services/utils/feed-bridge.js', () => ({bridgeFeed: jest.fn(async () => null)}));

const {findFeeds} = await import('../../services/utils/feed-finder.js');

beforeEach(() => fetchPublicUrl.mockClear());

describe('findFeeds on an address that died', () => {
    it('should try the root of its site, and find the feed it declares', async () => {
        const feeds = await findFeeds('https://www.club.example/en/rss.xml');

        expect(feeds.map(feed => feed.url)).toEqual([FEED]);
        expect(fetchPublicUrl.mock.calls.map(([url]) => url).slice(0, 2)).toEqual(['https://www.club.example/en/rss.xml', 'https://www.club.example/']);
    });

    it('should not try the root twice when the root itself is gone', async () => {
        fetchPublicUrl.mockImplementation(async (url) => ({res: {ok: false, status: 404}, url}));
        expect(await findFeeds('https://www.club.example/')).toEqual([]);
        expect(fetchPublicUrl.mock.calls.filter(([url]) => url === 'https://www.club.example/')).toHaveLength(1);
    });
});
