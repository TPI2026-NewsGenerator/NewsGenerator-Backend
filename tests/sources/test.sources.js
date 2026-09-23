//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.sources.js
//  Description: Tests for the discovery of the media missing from the sources (Google News query,
//               hostnames, same medium behind two hostnames)
//

import {toQuery} from '../../services/utils/google-news.js'
import {searchDirectory} from '../../services/utils/feed-directory.js'
import {mediaFor as gdeltMedia, toQuery as gdeltQuery} from '../../services/utils/gdelt.js'
import {hostOf, mediumOf, nameOf} from '../../services/utils/public-url.js'

describe('toQuery', () => {
    it('should keep a single keyword as it is', () => {
        expect(toQuery(['referee'], null)).toBe('referee');
    });

    it('should write the alternatives of a comma with OR', () => {
        expect(toQuery(['referee, VAR'], null)).toBe('(referee) OR (VAR)');
    });

    it('should keep the words of an alternative together (AND)', () => {
        expect(toQuery(['red card'], null)).toBe('red card');
    });

    it('should quote an exact phrase, and a term written with a space', () => {
        expect(toQuery(['"red card"'], null)).toBe('"red card"');
    });

    it('should exclude a term with a minus, whatever the alternatives', () => {
        expect(toQuery(['referee -rugby, VAR'], null)).toBe('(referee) OR (VAR) -rugby');
    });

    it('should limit Google News to the days of the timeframe', () => {
        expect(toQuery(['referee'], 2)).toBe('referee when:2d');
    });

    it('should give an empty query when there is no keyword', () => {
        expect(toQuery([], null)).toBe('');
        expect(toQuery(['  '], null)).toBe('');
    });
});

describe('hostOf', () => {
    it('should give the hostname without its www', () => {
        expect(hostOf('https://www.bbc.com/sport/x')).toBe('bbc.com');
        expect(hostOf('https://sports.yahoo.com')).toBe('sports.yahoo.com');
    });

    it('should give null when it is not an url', () => {
        expect(hostOf('not an url')).toBeNull();
        expect(hostOf(undefined)).toBeNull();
    });
});

describe('mediumOf', () => {
    it('should see two hostnames of the same medium as one, so it is not suggested again', () => {
        expect(mediumOf('rss.cnn.com')).toBe(mediumOf('edition.cnn.com'));
        expect(mediumOf('feeds.skynews.com')).toBe('skynews.com');
    });

    it('should keep the label before a two level ending, "bbc.co.uk" is not the ".uk" of every bbc', () => {
        expect(mediumOf('feeds.bbci.co.uk')).toBe('bbci.co.uk');
        expect(mediumOf('abc.net.au')).toBe('abc.net.au');
        expect(mediumOf('www.espn.com.sg')).toBe('espn.com.sg');
    });

    it('should not take a two letter word of the name for a country ending', () => {
        expect(mediumOf('si.com')).toBe('si.com');
        expect(mediumOf('rss.nytimes.com')).toBe('nytimes.com');
    });
});

describe('nameOf', () => {
    it('should see the two endings of a medium as the same one, so it is not suggested again', () => {
        expect(nameOf('bbc.com')).toBe(nameOf('www.bbc.co.uk'));
        expect(nameOf('reuters.com')).toBe('reuters');
    });

    it('should drop the subdomains of a feed', () => {
        expect(nameOf('rss.nytimes.com')).toBe('nytimes');
        expect(nameOf('feeds.content.dowjones.io')).toBe('dowjones');
    });
});

describe('searchDirectory', () => {
    const answer = (body, ok = true) => () => Promise.resolve({ok, json: () => Promise.resolve(body)});
    const realFetch = globalThis.fetch;

    afterEach(() => { globalThis.fetch = realFetch; });

    it('should read the feeds of the directory, the most read first', async () => {
        globalThis.fetch = answer({results: [
            {feedId: 'feed/https://small.com/rss', title: 'Small', website: 'https://small.com', language: 'en', subscribers: 12},
            {feedId: 'feed/https://big.com/rss', title: 'Big', website: 'https://big.com', language: 'en', subscribers: 900},
        ]});

        const feeds = await searchDirectory('football');

        expect(feeds.map(feed => feed.title)).toEqual(['Big', 'Small']);
        expect(feeds[0]).toEqual({url: 'https://big.com/rss', title: 'Big', site: 'https://big.com', language: 'en', subscribers: 900});
    });

    it('should drop an answer that is not an address', async () => {
        globalThis.fetch = answer({results: [{feedId: 'feed/not an url', title: 'Broken'}, {title: 'No feed at all'}]});
        expect(await searchDirectory('football')).toEqual([]);
    });

    it('should answer nothing when the directory fails, it is only a bonus', async () => {
        globalThis.fetch = () => Promise.reject(new Error('down'));
        expect(await searchDirectory('football')).toEqual([]);

        globalThis.fetch = answer({}, false);
        expect(await searchDirectory('football')).toEqual([]);
    });
});

describe('gdelt', () => {
    const answer = (body, ok = true) => () => Promise.resolve({
        ok, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
    const realFetch = globalThis.fetch;

    afterEach(() => { globalThis.fetch = realFetch; });

    it('should ask the language the search is in', () => {
        expect(gdeltQuery(['referee'], {language: 'fr'})).toBe('referee sourcelang:fre');
        expect(gdeltQuery(['referee, VAR'], {language: 'en'})).toBe('(referee OR VAR) sourcelang:eng');
        expect(gdeltQuery(['referee -rugby'], {language: 'en'})).toBe('referee -rugby sourcelang:eng');
    });

    it('should count the media of the articles, the one publishing the most first', async () => {
        globalThis.fetch = answer({articles: [
            {url: 'https://www.a.com/1', domain: 'www.a.com'},
            {url: 'https://a.com/2', domain: 'a.com'},
            {url: 'https://b.com/1', domain: 'b.com'},
            {url: 'https://b.com/2', domain: 'b.com'},
            {url: 'https://b.com/3', domain: 'b.com'},
        ]});

        expect(await gdeltMedia(['referee'])).toEqual([
            {site: 'b.com', name: 'b.com', news: 3},
            {site: 'a.com', name: 'a.com', news: 2},
        ]);
    });

    it('should drop a medium that only mentions the subject once', async () => {
        globalThis.fetch = answer({articles: [{url: 'https://passing.com/1', domain: 'passing.com'}]});
        expect(await gdeltMedia(['referee'])).toEqual([]);
    });

    it('should answer nothing when it refuses, it answers a sentence and not an error code', async () => {
        globalThis.fetch = answer('Please limit requests to one every 5 seconds');
        expect(await gdeltMedia(['referee'])).toEqual([]);

        globalThis.fetch = () => Promise.reject(new Error('connect timeout'));
        expect(await gdeltMedia(['referee'])).toEqual([]);
    });
});
