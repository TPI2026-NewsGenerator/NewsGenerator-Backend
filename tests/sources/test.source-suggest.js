//
//  Author: Fabian Rostello
//  Date: 29.09.2026
//  File: test.source-suggest.js
//  Description: What a search misses on the web: the media offered only with a feed on it, judged
//               by meaning
//

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

    it('should judge the feeds by the words without the embedder', async () => {
        embed.mockRejectedValue(new Error('embedder down'));
        const found = await ask(['arbitrage football']);

        expect(found.sources).toHaveLength(2);
        expect(findFeeds.mock.calls[0][1].judge).toBeUndefined();
    });
});
