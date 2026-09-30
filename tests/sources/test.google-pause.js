//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.google-pause.js
//  Description: A block of Google News pauses only what it hit: a block of the page of an article
//               stops the real addresses, not the searches; a block of a search stops everything
//

import process from 'node:process';
import {afterAll, beforeAll, describe, expect, it, jest} from '@jest/globals';

process.env.GOOGLE_NEWS_INTERVAL_MS = '1';

jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Xml: jest.fn()}}));

const {Crawlers} = await import('../../services/utils/crawlers.js');
const {decodeLinks, googleAvailable, readSearches} = await import('../../services/utils/google-news.js');

const SEARCH = 'https://news.google.com/rss/search?q=cartes&hl=fr&gl=FR&ceid=FR:fr';
const ITEM = {title: 'Des cartes Pokémon offertes - Purebreak', link: 'https://news.google.com/rss/articles/CBMi1',
    source: {url: 'https://www.purebreak.com', name: 'Purebreak'}};

const realFetch = globalThis.fetch;
beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterAll(() => {
    globalThis.fetch = realFetch;
    console.error.mockRestore();
});

// the two tests share the pauses of the module: they run in this order
describe('the pauses of Google News', () => {
    it('should keep the searches going when the page of an article is blocked', async () => {
        globalThis.fetch = jest.fn(async () => ({status: 429, ok: false, url: 'https://www.google.com/sorry/index'}));

        expect((await decodeLinks([ITEM.link])).size).toBe(0);
        expect(googleAvailable('articles')).toBe(false);
        expect(googleAvailable()).toBe(true);

        Crawlers.Xml.mockResolvedValue([{url: SEARCH, items: [ITEM]}]);
        const [feed] = await readSearches([SEARCH]);
        expect(feed.skipped).toBeUndefined();
        expect(feed.items[0].title).toBe('Des cartes Pokémon offertes');
    });

    it('should stop everything when a search is blocked', async () => {
        Crawlers.Xml.mockResolvedValue([{url: SEARCH, items: [], error: 'HTTP 429'}]);

        const [feed] = await readSearches([SEARCH]);

        expect(feed.skipped).toBe(true);
        expect(googleAvailable()).toBe(false);
        expect(googleAvailable('articles')).toBe(false);
    });
});
