//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.media-cloud.js
//  Description: Media Cloud as a second directory of media: its searches as a phrase in one language,
//               the media writing more than once, and the feeds of its directory without the sitemaps
//

import process from 'node:process';
import {afterAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {isSitemap, knownFeeds, mediaCloudEnabled, mediaFor, toQuery} from '../../services/utils/media-cloud.js';

const realFetch = globalThis.fetch;
const answer = (body) => ({ok: true, status: 200, json: async () => body});

beforeEach(() => {
    process.env.MEDIACLOUD_API_TOKEN = 'test-token';
});
afterAll(() => {
    globalThis.fetch = realFetch;
    delete process.env.MEDIACLOUD_API_TOKEN;
});

describe('toQuery', () => {
    it('should ask every word of a search, in its language', () => {
        expect(toQuery('Super League Suisse', 'fr')).toBe('(Super AND League AND Suisse) AND language:fr');
        expect(toQuery('UEFA', 'en')).toBe('UEFA AND language:en');
        expect(toQuery(' ("x") ', 'en')).toBe('x AND language:en');
        expect(toQuery('  ', 'en')).toBeNull();
    });
});

describe('mediaFor', () => {
    it('should give the media of the press of the language writing more than once, the most present first', async () => {
        globalThis.fetch = jest.fn(async () => answer({sources: [
            {source: 'lematin.ch', count: 26}, {source: 'laliberte.ch', count: 51}, {source: 'lagruyere.ch', count: 1},
        ]}));

        const media = await mediaFor('Ligue des champions', {language: 'fr'});

        expect(media.map(medium => [medium.site, medium.news, medium.lang])).toEqual([['laliberte.ch', 51, 'fr'], ['lematin.ch', 26, 'fr']]);
        const asked = new URL(globalThis.fetch.mock.calls[0][0]);
        expect(asked.pathname).toBe('/api/search/sources');
        expect(asked.searchParams.get('cs').split(',')).toContain('34411591');     // Switzerland - National
        expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Token test-token');
    });

    it('should ask nothing without a key or for a language it has no press of', async () => {
        globalThis.fetch = jest.fn();
        delete process.env.MEDIACLOUD_API_TOKEN;
        expect(mediaCloudEnabled()).toBe(false);
        expect(await mediaFor('UEFA', {language: 'fr'})).toEqual([]);
        process.env.MEDIACLOUD_API_TOKEN = 'test-token';
        expect(await mediaFor('UEFA', {language: 'nl'})).toEqual([]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});

describe('knownFeeds', () => {
    it('should give the feeds of this medium only, without the sitemaps', async () => {
        globalThis.fetch = jest.fn()
            .mockResolvedValueOnce(answer({results: [{id: 9, name: 'freep.com'}]}))
            .mockResolvedValueOnce(answer({results: [
                {url: 'https://www.freep.com/news-sitemap.xml'},
                {url: 'http://rssfeeds.freep.com/freep/entertainment'},
                {url: 'https://zambianobserver.com/?feed=rss'},
            ]}));

        expect(await knownFeeds('freep.com')).toEqual(['http://rssfeeds.freep.com/freep/entertainment']);
        expect(new URL(globalThis.fetch.mock.calls[1][0]).searchParams.get('source_id')).toBe('9');
    });

    it('should know nothing of a medium its directory names another', async () => {
        globalThis.fetch = jest.fn().mockResolvedValueOnce(answer({results: [{id: 3, name: 'zambianobserver.com'}]}));
        expect(await knownFeeds('observer.com')).toEqual([]);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('should tell the sitemaps of Google News from the feeds', () => {
        expect(isSitemap('https://www.nicematin.com/googlenews.xml')).toBe(true);
        expect(isSitemap('https://www.liverpoolecho.co.uk/map_news.xml')).toBe(true);
        expect(isSitemap('https://bleacherreport.com/sitemaps/google_news')).toBe(true);
        expect(isSitemap('http://www.nicematin.com/rugby/rss')).toBe(false);
    });
});
