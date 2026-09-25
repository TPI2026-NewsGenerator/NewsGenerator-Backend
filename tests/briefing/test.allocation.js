//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.allocation.js
//  Description: Tests for the feeds kept for a profile, shared between its interests
//

import {allocate} from '../../services/utils/allocation.js'

describe('allocate', () => {
    it('should take the feeds in turn from each interest, the best first', () => {
        const kept = allocate([
            [{url: 'r1', score: 1}, {url: 'r2', score: 3}, {url: 'r3', score: 2}],
            [{url: 'f1', score: 5}],
        ], 3);
        expect(kept.map(feed => feed.url)).toEqual(['r2', 'f1', 'r3']);
    });

    it('should keep a feed found for two interests once', () => {
        const kept = allocate([[{url: 'a', score: 1}], [{url: 'a', score: 2}, {url: 'b', score: 1}]], 5);
        expect(kept.map(feed => feed.url)).toEqual(['a', 'b']);
    });

    it('should keep nothing without room', () => {
        expect(allocate([[{url: 'a', score: 1}]], 0)).toEqual([]);
    });
});
