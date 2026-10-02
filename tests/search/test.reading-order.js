//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.reading-order.js
//  Description: Which articles of a card of the search are read for its resume and its count
//

import {onceEach, readingOrder} from '../../services/utils/reading-order.js'

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

describe('onceEach', () => {
    const news = (link, title, feed = 'https://feeds.test/rss') => ({link, title, feeds: {url: feed}});
    const fromGoogle = (item) => item.feeds.url.includes('news.google.com');

    it('should list one title of one medium once, from its feed before Google News', () => {
        const google = news('https://news.google.com/rss/articles/1', "L'UEFA a reçu des documents", 'https://news.google.com/rss/search?q=uefa');
        const feed = news('https://www.lequipe.fr/a/1', "L’UEFA a reçu des documents");
        const other = news('https://www.sofoot.com/a/1', "L'UEFA a reçu des documents");
        expect(onceEach([google, feed, other], {medium: (item) => item.link.includes('google') ? 'lequipe.fr' : new URL(item.link).hostname.replace(/^www\./, ''), fromGoogle}))
            .toEqual([feed, other]);
    });

    it('should list the news of two addresses of one medium once, and keep two titles of it', () => {
        const a = news('https://news.maxifoot.fr/a', 'Real : Negreira, le communiqué du club');
        const b = news('https://m.maxifoot.fr/a', 'Real : Negreira, le communiqué du club');
        const c = news('https://m.maxifoot.fr/b', 'Barça : la réponse du club');
        expect(onceEach([a, b, c])).toEqual([a, c]);
    });
});
