//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.allocation.js
//  Description: Tests for the feeds kept for a profile, shared between its interests
//

import {allocate, pressSearches, staleFeeds, tryPerLanguage} from '../../services/utils/allocation.js'

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

describe('tryPerLanguage', () => {
    const medium = (site, lang) => ({site, lang});
    const feedsOf = (sites) => async (m) => sites.includes(m.site) ? {site: m.site} : null;

    it('should give each language its own tries, not only the most present', async () => {
        const media = [
            medium('en1', 'en'), medium('en2', 'en'), medium('en3', 'en'), medium('en4', 'en'),
            medium('fr1', 'fr'), medium('fr2', 'fr'),
        ];
        const found = await tryPerLanguage(media, feedsOf(['en1', 'en2', 'en3', 'fr2']));
        expect(found.map(feed => feed.site)).toEqual(['en1', 'en2', 'fr2']);
    });

    it('should go on past the media without a feed, up to the tries allowed', async () => {
        const media = ['a', 'b', 'c', 'd', 'e', 'f'].map(site => medium(site, 'fr'));
        const tried = [];
        const found = await tryPerLanguage(media, async (m) => {
            tried.push(m.site);
            return ['e', 'f'].includes(m.site) ? {site: m.site} : null;
        });
        expect(found.map(feed => feed.site)).toEqual(['e']);
        expect(tried).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should stop a language once enough are kept', async () => {
        const media = ['a', 'b', 'c', 'd'].map(site => medium(site, 'en'));
        const tried = [];
        await tryPerLanguage(media, async (m) => {
            tried.push(m.site);
            return {site: m.site};
        }, {kept: 2, tried: 5, wave: 2});
        expect(tried).toEqual(['a', 'b']);
    });
});

describe('staleFeeds', () => {
    const now = new Date('2026-10-20T12:00:00Z').getTime();
    const daysAgo = (days) => new Date(now - days * 24 * 3600e3);
    const options = {now, graceDays: 14, minNews: 30};

    it('should remove a feed with no news on the profile once it had the time to show one', () => {
        const rows = [
            {id: 1, url: 'latimes', created_at: daysAgo(20), news: 12, relevant: 0},
            {id: 2, url: 'goal', created_at: daysAgo(20), news: 94, relevant: 18},
        ];
        expect(staleFeeds(rows, options).map(row => row.id)).toEqual([1]);
    });

    it('should give a feed just found its time, unless it already published enough to say it', () => {
        const rows = [
            {id: 1, url: 'quiet', created_at: daysAgo(3), news: 5, relevant: 0},
            {id: 2, url: 'off-subject', created_at: daysAgo(3), news: 99, relevant: 0},
        ];
        expect(staleFeeds(rows, options).map(row => row.id)).toEqual([2]);
    });

    it('should remove a dead feed, and never one the reader kept', () => {
        const rows = [
            {id: 1, url: 'dead', created_at: daysAgo(15), news: 0, relevant: 0},
            {id: 2, url: 'kept', created_at: daysAgo(30), news: 50, relevant: 0},
        ];
        expect(staleFeeds(rows, {...options, kept: ['kept']}).map(row => row.id)).toEqual([1]);
    });
});

describe('pressSearches', () => {
    it('should ask both searches of the language of the reader and of English, the first only of the others', () => {
        const searches = [
            {lang: 'fr', q: 'arbitrage football'}, {lang: 'fr', q: 'analyse VAR'},
            {lang: 'en', q: 'football referee'}, {lang: 'en', q: 'VAR analysis'},
            {lang: 'es', q: 'arbitraje fútbol'}, {lang: 'es', q: 'decisión VAR'},
            {lang: 'it', q: 'arbitraggio calcio'},
        ];
        expect(pressSearches(searches, 'fr').map(search => search.q)).toEqual([
            'arbitrage football', 'analyse VAR', 'football referee', 'VAR analysis', 'arbitraje fútbol', 'arbitraggio calcio',
        ]);
        expect(pressSearches(searches, 'es').map(search => search.q)).toEqual([
            'arbitrage football', 'football referee', 'VAR analysis', 'arbitraje fútbol', 'decisión VAR', 'arbitraggio calcio',
        ]);
    });
});
