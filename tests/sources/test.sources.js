//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.sources.js
//  Description: Tests for the discovery of the media missing from the sources (Google News query,
//               hostnames, same medium behind two hostnames)
//

import {toQuery} from '../../services/utils/google-news.js'
import {hostOf, mediumOf} from '../../services/utils/public-url.js'

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
