//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: test.source-suggest.js
//  Description: What a search misses on the web: the media offered only with a feed on it, judged
//               by meaning. And the sites of a list a reader imports, with what keeps each out
//

import process from 'node:process';
import {jest} from '@jest/globals';

jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {userFeedUrls: jest.fn(async () => []), articleHosts: jest.fn(async () => [])},
}));
jest.unstable_mockModule('../../services/utils/google-news.js', () => ({search: jest.fn()}));
jest.unstable_mockModule('../../services/utils/gdelt.js', () => ({mediaFor: jest.fn(async () => [])}));
jest.unstable_mockModule('../../services/utils/feed-directory.js', () => ({searchDirectory: jest.fn(async () => [])}));
jest.unstable_mockModule('../../services/utils/feed-finder.js', () => ({
    findFeeds: jest.fn(),
    isOnSubject: (feed) => feed.onSubject >= 2,
}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({
    embed: jest.fn(),
    denseSimilarity: jest.fn(() => 1),
}));

const {SourceService} = await import('../../services/source-service.js');
const {search} = await import('../../services/utils/google-news.js');
const {findFeeds} = await import('../../services/utils/feed-finder.js');
const {embed} = await import('../../services/utils/embedder.js');
const {FeedModel} = await import('../../models/feed-model.js');

const item = (id, site, title, day) => ({title, url: `https://news.google.com/${id}`, site, name: site, publishedAt: `2026-09-${day}T10:00:00Z`});
const NEWS = [
    item(0, 'footmercato.net', 'VAR : le penalty refusé à Lens', 27),
    item(1, 'midilibre.fr', "L'arbitre vidéo au centre de Toulouse-Montpellier", 28),
];
const MEDIA = [{site: 'midilibre.fr', name: 'Midi Libre', news: 5}, {site: 'footmercato.net', name: 'footmercato.net', news: 1}];
const feed = (site, onSubject) => ({url: `https://${site}/rss`, onSubject, judged: 20, titles: [`${site} title`]});

const ask = (keywords) => SourceService.suggest({keywords, userId: 1, language: 'fr', timeframe: {start: new Date(Date.now() - 7 * 864e5).toISOString()}});

describe('SourceService.suggest', () => {
    beforeEach(() => {
        search.mockResolvedValue({news: NEWS, media: MEDIA});
        embed.mockResolvedValue([{dense: [1, 0]}]);
        findFeeds.mockImplementation(async (site) => [feed(site, 5)]);
    });
    afterEach(() => jest.clearAllMocks());

    it('should judge the feeds by the meaning of the search, and give the news newest first', async () => {
        const found = await ask(["les décisions de l'arbitrage vidéo en Ligue 1"]);

        expect(found.news.map(news => news.site)).toEqual(['midilibre.fr', 'footmercato.net']);
        expect(found.sources.map(source => source.site)).toEqual(['midilibre.fr', 'footmercato.net']);
        expect(findFeeds.mock.calls[0][1].judge).toEqual(expect.any(Function));
        expect(embed).toHaveBeenCalledWith(["les décisions de l'arbitrage vidéo en Ligue 1"]);
    });

    it('should not offer a medium whose feed is not on the search', async () => {
        findFeeds.mockImplementation(async (site) => [feed(site, site === 'midilibre.fr' ? 0 : 6)]);
        const found = await ask(['arbitrage football']);
        expect(found.sources.map(source => source.site)).toEqual(['footmercato.net']);
        expect(found.tried).toBe(2);
    });

    it('should offer a site read through the bridge without its address, by its key', async () => {
        process.env.RSS_BRIDGE_URL = 'http://rss-bridge';
        try {
            findFeeds.mockImplementation(async (site) => [site === 'midilibre.fr'
                ? {...feed(site, 5), url: 'http://rss-bridge/?action=display&home_page=https%3A%2F%2Fmidilibre.fr'}
                : feed(site, 5)]);
            const found = await ask(['arbitrage football']);

            expect(JSON.stringify(found)).not.toContain('rss-bridge');
            expect(found.sources.map(({site, key, feed}) => ({site, key: typeof key, feed}))).toEqual([
                {site: 'midilibre.fr', key: 'string', feed: null},
                {site: 'footmercato.net', key: 'string', feed: 'https://footmercato.net/rss'},
            ]);
        } finally {
            delete process.env.RSS_BRIDGE_URL;
        }
    });

    it('should judge the feeds by the words without the embedder', async () => {
        embed.mockRejectedValue(new Error('embedder down'));
        const found = await ask(['arbitrage football']);

        expect(found.sources).toHaveLength(2);
        expect(findFeeds.mock.calls[0][1].judge).toBeUndefined();
    });
});

describe('SourceService.checkSites', () => {
    const found = (url, changes = {}) => ({url, recent: 40, items: 50, language: 'de', titles: ['Bayern gewinnt'], ...changes});

    beforeEach(() => {
        process.env.RSS_BRIDGE_URL = 'http://rss-bridge';
        FeedModel.userFeedUrls.mockResolvedValue(['https://www.tipsbladet.dk/rss']);
        findFeeds.mockImplementation(async (site) => ({
            'https://www.kicker.de': [found('https://newsfeed.kicker.de/news/aktuell')],
            'https://www.vi.nl': [found('http://rss-bridge/?action=display&url=vi.nl')],
            'https://www.irishfa.com': [found('https://www.irishfa.com/rss', {items: 5882})],
            'https://www.gibraltarfa.com': [found('https://www.gibraltarfa.com/feed', {recent: 1})],
            'https://www.tipsbladet.dk': [found('https://www.tipsbladet.dk/rss')],
            'https://www.uefa.com': [],
        })[site] ?? Promise.reject(new Error('"www.nowhere.ad" does not exist.')));
    });
    afterEach(() => {
        delete process.env.RSS_BRIDGE_URL;
    });

    it('should tell for each site of a list its feed and what keeps it out', async () => {
        const sites = ['https://www.kicker.de', 'https://www.vi.nl', 'https://www.irishfa.com', 'https://www.gibraltarfa.com',
            'https://www.tipsbladet.dk', 'https://www.uefa.com', 'https://www.nowhere.ad'];
        const checked = await SourceService.checkSites({sites, userId: 1, language: 'en'});

        expect(checked.map(site => site.status)).toEqual(['ready', 'bridge', 'flood', 'asleep', 'added', 'none', 'none']);
        expect(checked[0]).toMatchObject({site: 'https://www.kicker.de', feed: 'https://newsfeed.kicker.de/news/aktuell', language: 'de', recent: 40, sample: 'Bayern gewinnt'});
        expect(checked[6].reason).toBe('"www.nowhere.ad" does not exist.');
        // read from its page: no address on the bridge, a key to choose it
        expect(checked[1]).toMatchObject({site: 'https://www.vi.nl', status: 'bridge', feed: null, key: expect.stringMatching(/^[0-9a-f]{16}$/)});
        expect(JSON.stringify(checked)).not.toContain('rss-bridge');
    });
});
