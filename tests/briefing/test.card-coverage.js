//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: test.card-coverage.js
//  Description: How widely a card's news is told, from its own articles, for the e-mail: the same count as the page (the cases of the
//               client's card-coverage.test.js, with the same answers)
//

import {describe, expect, it} from '@jest/globals';
import {coverageOfCard} from '../../services/utils/card-coverage.js';

const article = (source, at, language = 'en') => ({source, publishedAt: at, language, url: `https://${source}`});
const hour = (n) => new Date(Date.UTC(2026, 10, 3, 12 + n)).toISOString();

describe('coverageOfCard', () => {
    it('should count the media and the languages, and name the first medium to tell it', () => {
        const coverage = coverageOfCard({articles: [article('b.fr', hour(2), 'fr'), article('a.com', hour(0)), article('c.com', hour(1)), article('d.de', hour(3), 'de')]});
        expect(coverage.media).toBe(4);
        expect(coverage.first).toEqual({source: 'a.com', at: hour(0)});
        expect(coverage.last).toEqual({at: hour(3)});
        expect(coverage.list.map(one => one.source)).toEqual(['a.com', 'c.com', 'b.fr', 'd.de']);
        expect(coverage.languages).toEqual([{language: 'en', media: 2}, {language: 'de', media: 1}, {language: 'fr', media: 1}]);
    });

    it('should give the bars of the hours, a bar an hour within the half day', () => {
        const coverage = coverageOfCard({articles: [article('a.com', hour(0)), article('b.com', hour(0)), article('c.com', hour(2))]});
        expect(coverage.bars.map(bar => bar.count)).toEqual([2, 0, 1]);
        expect(coverage.binMs).toBe(3600e3);
    });

    it('should widen the bars for a news told over days, 12 at most', () => {
        const coverage = coverageOfCard({articles: [article('a.com', hour(0)), article('b.com', hour(24 * 6))]});
        expect(coverage.bars.length).toBeLessThanOrEqual(12);
        expect(coverage.bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(2);
        // 6 days in 11 bars at most: 14 hours
        expect(coverage.binMs).toBe(14 * 3600e3);
    });

    it('should take the media the card counts when they are more than its articles, and put the articles with no date last', () => {
        const coverage = coverageOfCard({corroboration: {media: 9}, articles: [{source: 'x.com', url: 'https://x.com'}, article('a.com', hour(0))]});
        expect(coverage.media).toBe(9);
        expect(coverage.list.map(one => one.source)).toEqual(['a.com', 'x.com']);
    });

    it('should answer nothing for a card without articles, and no bar without a date', () => {
        expect(coverageOfCard({articles: []})).toBeNull();
        expect(coverageOfCard(undefined)).toBeNull();
        const undated = coverageOfCard({articles: [{source: 'x.com', url: 'https://x.com'}]});
        expect(undated.bars).toEqual([]);
        expect(undated.first).toBeNull();
    });
});
