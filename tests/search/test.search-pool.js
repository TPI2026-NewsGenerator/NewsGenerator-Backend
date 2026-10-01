//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.search-pool.js
//  Description: The searches of Google News of the profiles a search reads: of its language, and of
//               the interests of its categories. And the sentences searched before, of its language
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/profile-model.js', () => ({
    ProfileModel: {
        searchesOf: jest.fn(async () => [
            {searches: ['fr:cartes Pokémon', 'en:Pokemon TCG'], languages: ['fr', 'en'], category: 'technology'},
            {searches: ['fr:arbitrage football'], languages: ['fr'], category: 'sport'},
            {searches: ['fr:voile'], languages: ['fr'], category: null},
            {searches: ['fr:jeux de cartes'], languages: ['en'], category: 'technology'},
        ]),
    },
}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {googleSearchFeeds: jest.fn()}}));
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {}}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {}}));
jest.unstable_mockModule('../../services/directory-service.js', () => ({DirectoryService: {}}));

const {searchesOfCategories, sentenceFeeds} = await import('../../services/ingest-service.js');
const {FeedModel} = await import('../../models/feed-model.js');
const {sentenceUrl} = await import('../../services/utils/google-news.js');

describe('searchesOfCategories', () => {
    it('should give the searches in the language asked, of the interests of these categories or of none', async () => {
        const urls = await searchesOfCategories(['technology'], 'fr');
        const queries = urls.map(url => new URL(url).searchParams.get('q'));

        expect(queries).toHaveLength(2);
        expect(queries[0]).toMatch(/^cartes Pokémon/);
        expect(queries[1]).toMatch(/^voile/);
        expect(urls.every(url => url.includes('hl=fr'))).toBe(true);
    });
});

describe('searchesOfCategories of every language', () => {
    it('should give the searches of every language of the readers', async () => {
        const urls = await searchesOfCategories(['technology']);

        expect(urls.some(url => url.includes('hl=fr'))).toBe(true);
        expect(urls.some(url => url.includes('hl=en'))).toBe(true);
        expect(urls.map(url => new URL(url).searchParams.get('q')).some(q => /arbitrage/.test(q))).toBe(false);
    });
});

describe('sentenceFeeds', () => {
    it('should give the sentences searched in the language asked, not the searches of the profiles', async () => {
        const [profile] = await searchesOfCategories(['technology'], 'fr');
        const french = sentenceUrl("les prix de l'immobilier en Suisse", {days: 7, language: 'fr'});
        const english = sentenceUrl('measles outbreaks', {days: 7, language: 'en'});
        FeedModel.googleSearchFeeds.mockResolvedValueOnce([profile, french, english]);

        expect(await sentenceFeeds('fr')).toEqual([french]);
        const [[since]] = FeedModel.googleSearchFeeds.mock.calls;
        expect(Date.now() - since.getTime()).toBeGreaterThan(29 * 24 * 3600e3);
    });

    it('should give the sentences of every language without one', async () => {
        const [profile] = await searchesOfCategories(['technology'], 'fr');
        const french = sentenceUrl("les prix de l'immobilier en Suisse", {days: 7, language: 'fr'});
        const english = sentenceUrl('measles outbreaks', {days: 7, language: 'en'});
        FeedModel.googleSearchFeeds.mockResolvedValueOnce([profile, french, english]);

        expect(await sentenceFeeds()).toEqual([french, english]);
    });
});
