//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.feed-finder-known.js
//  Description: The feeds another directory knows for a site are candidates like the ones it declares:
//               freep.com declares none on its page, Media Cloud knows rssfeeds.freep.com
//

import {describe, expect, it, jest} from '@jest/globals';

const KNOWN = 'http://rssfeeds.freep.com/freep/entertainment';

jest.unstable_mockModule('../../services/utils/public-url.js', () => ({
    assertPublicUrl: async (value) => new URL(value),
    fetchPublicUrl: async (url) => ({res: {ok: true, text: async () => '<html><body>No feed here</body></html>'}, url}),
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
        Xml: jest.fn(async (feeds) => feeds.map(({url}) => ({url, items: url === KNOWN
            ? [{title: 'A news of the entertainment', link: 'https://www.freep.com/story/1', pubDate: new Date().toUTCString()}]
            : []}))),
    },
}));
jest.unstable_mockModule('../../services/utils/feed-directory.js', () => ({searchDirectory: jest.fn(async () => [])}));
jest.unstable_mockModule('../../services/utils/feed-bridge.js', () => ({bridgeFeed: jest.fn(async () => null)}));

const {findFeeds} = await import('../../services/utils/feed-finder.js');
const {Crawlers} = await import('../../services/utils/crawlers.js');

describe('findFeeds with the feeds another directory knows', () => {
    it('should check them with the usual paths and give the one that answers', async () => {
        const feeds = await findFeeds('freep.com', {known: [KNOWN]});

        expect(feeds.map(feed => feed.url)).toEqual([KNOWN]);
        expect(Crawlers.Xml.mock.calls[0][0].map(({url}) => url)).toEqual(expect.arrayContaining(['https://freep.com/rss', KNOWN]));
    });
});
