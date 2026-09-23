//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: test.bridge.js
//  Description: Tests for the reading of a page into a list of articles, what a feed is built from
//

import {articlePatterns} from '../../services/utils/feed-bridge.js'

// a page with 'links' anchors under each prefix given
const page = (prefixes) => '<html><body>' + Object.entries(prefixes)
    .flatMap(([prefix, links]) => Array.from({length: links}, (_, i) => `<a href="${prefix}article-${i}">a</a>`))
    .join('') + '</body></html>';

describe('articlePatterns', () => {
    it('should prefer a section of articles over a section with more links', () => {
        // the English page of goal.com links more teams than news
        const patterns = articlePatterns(page({'/en/team/': 40, '/en/news/': 12}), {language: 'en'});
        expect(patterns[0]).toBe('/en/news/');
    });

    it('should prefer the language wanted when no section is named', () => {
        const patterns = articlePatterns(page({'/es-ES/deportes/': 30, '/en-US/sports/': 10}), {language: 'en'});
        expect(patterns[0]).toBe('/en-US/sports/');
    });

    it('should drop the root of a language, everything of a site is under it', () => {
        const patterns = articlePatterns(page({'/en/': 50, '/en/news/': 6}), {language: 'en'});
        expect(patterns).toEqual(['/en/news/']);
    });

    it('should keep a section named at the root of the site', () => {
        expect(articlePatterns(page({'/news/': 20}))).toEqual(['/news/']);
    });

    it('should ignore a prefix carried by too few links', () => {
        expect(articlePatterns(page({'/en/news/': 2}), {language: 'en'})).toEqual([]);
    });

    it('should ignore the links that are a section, not an article', () => {
        expect(articlePatterns('<a href="/news">News</a><a href="/sport">Sport</a>')).toEqual([]);
    });

    it('should read the links written with the whole address', () => {
        const html = Array.from({length: 8}, (_, i) => `<a href="https://www.goal.com/en/news/story-${i}">x</a>`).join('');
        expect(articlePatterns(html, {language: 'en'})).toEqual(['/en/news/']);
    });
});

describe('articlePatterns, sections that are never news', () => {
    const page = (prefixes) => '<html><body>' + Object.entries(prefixes)
        .flatMap(([prefix, links]) => Array.from({length: links}, (_, i) => `<a href="${prefix}page-${i}">a</a>`))
        .join('') + '</body></html>';

    it('should drop the legal pages, which a site links from everywhere', () => {
        // ligue1.com links its legal notices more than its articles, and they carry a title and a date
        expect(articlePatterns(page({'/fr/legal/': 30, '/fr/actualites/': 8}), {language: 'fr'}))
            .toEqual(['/fr/actualites/']);
    });

    it('should drop the shop, the contact and the newsletter too', () => {
        expect(articlePatterns(page({'/en/tickets/': 20, '/en/contact/': 15, '/en/newsletter/': 12}))).toEqual([]);
    });
});
