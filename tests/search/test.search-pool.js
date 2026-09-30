//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.search-pool.js
//  Description: The searches of Google News of the profiles a search reads: of its language, and of
//               the interests of its categories
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
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {}}));
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {}}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {}}));
jest.unstable_mockModule('../../services/directory-service.js', () => ({DirectoryService: {}}));

const {searchesOfCategories} = await import('../../services/ingest-service.js');

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
