//
//  Author: Fabian Rostello
//  Date: 05.10.2026
//  File: test.feed-titles.js
//  Description: A news without title nor description (nordeclair.fr, zdfheute.de, 20min.ch) is not
//               saved: nothing to show, and an empty title is no news to group
//

import {describe, expect, it, jest} from '@jest/globals';

const insertArticles = jest.fn(async (articles) => articles.length);
jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {
        syncFeeds: async (urls) => urls.map((url, i) => ({id: i + 1, url})),
        updateFeed: async () => {},
        withoutRepeats: async (articles) => articles,
        insertArticles,
    },
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({
    Crawlers: {
        Xml: async (feeds) => feeds.map(({url}) => ({url, items: [
            {title: 'A title', link: 'https://paper.invalid/a', description: '', category: null},
            {title: '', link: 'https://paper.invalid/b', description: '', category: null},
        ]})),
    },
}));
jest.unstable_mockModule('../../services/utils/google-news.js', () => ({
    isGoogleNewsUrl: () => false,
    readSearches: async () => [],
}));
const {FeedService} = await import('../../services/feed-service.js');

describe('FeedService.refreshUrls', () => {
    it('should not save a news without title', async () => {
        const stats = await FeedService.refreshUrls(['https://paper.invalid/feed']);
        expect(stats.inserted).toBe(1);
        expect(insertArticles.mock.calls[0][0].map(article => article.link)).toEqual(['https://paper.invalid/a']);
    });
});
