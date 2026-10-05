//
//  Author: Fabian Rostello
//  Date: 05.10.2026
//  File: test.feed-repeats.js
//  Description: A news a feed gives again under another link (same title, same date of publication)
//               is not saved again
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const queryRawUnsafe = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {$queryRawUnsafe: queryRawUnsafe}}));
const {FeedModel} = await import('../../models/feed-model.js');

const at = new Date('2026-10-05T10:00:00Z');
const news = (id_feed, link, title, published_at = at) => ({id_feed, link, title, published_at});

beforeEach(() => queryRawUnsafe.mockReset());

describe('withoutRepeats', () => {
    it('should leave out a news its feed gave already under another link, and keep the others', async () => {
        queryRawUnsafe.mockResolvedValueOnce([{id_feed: 1, title: 'Spagna: Feijoo', published_at: at}]);
        const kept = await FeedModel.withoutRepeats([
            news(1, 'https://agenzianova.com/a/6ac3b35c7c9627.05154239/7848673/feijoo', 'Spagna: Feijoo'),
            news(1, 'https://agenzianova.com/a/6ac3b35c7c0d90.27981733/7848676/marocco', 'Marocco: 250 borse'),
            news(2, 'https://other.it/feijoo', 'Spagna: Feijoo'),
            news(1, 'https://agenzianova.com/a/6ac3b35c7c0d90.27981733/7848670/feijoo', 'Spagna: Feijoo', new Date('2026-10-06T10:00:00Z')),
        ]);
        expect(kept.map(article => article.link)).toEqual([
            'https://agenzianova.com/a/6ac3b35c7c0d90.27981733/7848676/marocco',
            'https://other.it/feijoo',
            'https://agenzianova.com/a/6ac3b35c7c0d90.27981733/7848670/feijoo',
        ]);
        // each feed and date asked once
        expect(queryRawUnsafe.mock.calls[0][1]).toEqual([1, 2, 1]);
    });

    it('should keep a news once when a read gives it twice, and keep the news without a date', async () => {
        queryRawUnsafe.mockResolvedValueOnce([]);
        const kept = await FeedModel.withoutRepeats([
            news(1, 'https://a.it/x?t=1', 'Same'),
            news(1, 'https://a.it/x?t=2', 'Same'),
            news(1, 'https://a.it/live1', 'Live', null),
            news(1, 'https://a.it/live2', 'Live', null),
        ]);
        expect(kept.map(article => article.link)).toEqual(['https://a.it/x?t=1', 'https://a.it/live1', 'https://a.it/live2']);
    });

    it('should not ask the database when no news has a date', async () => {
        expect(await FeedModel.withoutRepeats([news(1, 'https://a.it/x', 'X', null)])).toHaveLength(1);
        expect(queryRawUnsafe).not.toHaveBeenCalled();
    });
});
