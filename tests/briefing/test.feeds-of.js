//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: test.feeds-of.js
//  Description: The feeds a briefing reads: the sources of every reader, except the ones found for the
//               profile that the reader removed
//

import {describe, expect, it, jest} from '@jest/globals';

const removedSources = jest.fn(async () => [{url: 'https://removed.example/rss', site: 'removed.example', category: 'world', language: 'en'}]);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {removedSources}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {
    userFeedUrls: jest.fn(async () => ['https://own.example/rss']),
    everyoneFeedUrls: jest.fn(async () => ['https://other.example/rss', 'https://removed.example/rss']),
}}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({IngestService: {}, searchesOfUser: jest.fn(async () => [])}));
const {feedsOf} = await import('../../services/briefing-service.js');

describe('feedsOf', () => {
    it('should read the sources of the other readers, not one the reader removed from their profile', async () => {
        const feeds = await feedsOf(3);

        expect(removedSources).toHaveBeenCalledWith(3);
        expect(feeds).toEqual(expect.arrayContaining(['https://own.example/rss', 'https://other.example/rss']));
        expect(feeds).not.toContain('https://removed.example/rss');
    });
});
