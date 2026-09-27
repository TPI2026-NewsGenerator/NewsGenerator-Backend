//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.reading-order.js
//  Description: Which articles of a card of the search are read for its resume and its count
//

import {readingOrder} from '../../services/utils/reading-order.js'

const article = (medium, hours, feed = `https://${medium}/rss`) => ({
    link: `https://${medium}/news-${hours}`,
    medium,
    published_at: new Date(Date.UTC(2026, 8, 28, 12 - hours)),
    feeds: {url: feed},
});

describe('readingOrder', () => {
    it('should read the lead first, then one article per other medium, the newest first', () => {
        const lead = article('lemonde.fr', 3);
        const order = readingOrder([lead, article('lequipe.fr', 5), article('lemonde.fr', 1), article('rmc.fr', 2)]);
        expect(order.map(a => a.medium)).toEqual(['lemonde.fr', 'rmc.fr', 'lequipe.fr']);
        expect(order[0]).toBe(lead);
    });

    it('should read a source the reader trusts first, so the resume is written from it', () => {
        const trusted = article('lequipe.fr', 5);
        const order = readingOrder([article('lemonde.fr', 3), trusted], new Set([trusted.feeds.url]));
        expect(order[0]).toBe(trusted);
    });

    it('should read five articles at most', () => {
        const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((medium, i) => article(`${medium}.fr`, i));
        expect(readingOrder(many)).toHaveLength(5);
    });
});
