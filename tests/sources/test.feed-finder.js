//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.feed-finder.js
//  Description: The feeds a site declares that are not its news
//

import {isCommentsFeed} from '../../services/utils/feed-finder.js';

describe('isCommentsFeed', () => {
    it('should tell the comments of a WordPress site from its news', () => {
        expect(isCommentsFeed('https://www.justarsenal.com/comments/feed')).toBe(true);
        expect(isCommentsFeed('https://example.com/comments/feed/')).toBe(true);
        expect(isCommentsFeed('https://example.com/?feed=comments-rss2')).toBe(true);
        expect(isCommentsFeed('https://www.justarsenal.com/feed')).toBe(false);
        expect(isCommentsFeed('https://example.com/category/comments-and-analysis/feed/')).toBe(false);
    });
});
