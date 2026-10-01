//
//  Author: Fabian Rostello
//  Date: 01.10.2026
//  File: test.feed-rhythm.js
//  Description: A feed is read again after a time set by the news it gave in the last 24 hours: the
//               busy ones every 2 minutes, the quiet ones every hour, the failing ones less often
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {}}));
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {}}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {}}));
jest.unstable_mockModule('../../services/directory-service.js', () => ({DirectoryService: {}}));
jest.unstable_mockModule('../../services/feed-service.js', () => ({FeedService: {}, RETENTION_DAYS: 30}));

const {feedsDue, readEvery} = await import('../../services/ingest-service.js');

const NOW = Date.UTC(2026, 9, 1, 12);
const minutesAgo = (minutes) => new Date(NOW - minutes * 60e3);
const feed = (url, news, readMinutesAgo, failures = 0) => ({url, news, failures, last_fetched_at: readMinutesAgo === null ? null : minutesAgo(readMinutesAgo)});

describe('the rhythm of a feed', () => {
    it('should read a feed less often the fewer news it gives', () => {
        expect([200, 72, 71, 24, 6, 1, 0].map(news => readEvery({url: 'https://a.ch/rss', news, failures: 0})))
            .toEqual([2, 2, 5, 5, 15, 30, 60]);
    });

    it('should read a failing feed twice less often per failure, every hour at most', () => {
        expect([0, 1, 2, 3, 4, 5, 40].map(failures => readEvery({url: 'https://a.ch/rss', news: 100, failures})))
            .toEqual([2, 4, 8, 16, 32, 60, 60]);
    });

    it('should read a search of Google News every hour, whatever its news', () => {
        expect(readEvery({url: 'https://news.google.com/rss/search?q=VAR', news: 500, failures: 0})).toBe(60);
    });

    it('should give the feeds never read and the ones read longer ago than their rhythm', () => {
        const rows = [
            feed('https://busy.ch/rss', 150, 2),
            feed('https://busy.ch/sport', 150, 1),
            feed('https://quiet.ch/rss', 0, 59),
            feed('https://quiet.ch/old', 0, 61),
            feed('https://new.ch/rss', 0, null),
        ];

        expect(feedsDue(rows, NOW)).toEqual(['https://busy.ch/rss', 'https://quiet.ch/old', 'https://new.ch/rss']);
    });
});
