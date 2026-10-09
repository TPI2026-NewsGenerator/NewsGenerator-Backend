//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.directory.js
//  Description: The directory of the project: which sections of a medium already read are worth
//               reading, the category they go to, and which feeds serve no reader
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {}}));

const {chooseSections, sectionCategory, uselessFeeds} = await import('../../services/directory-service.js');

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600e3).toUTCString();
const feed = (url, links, hours = 1) => ({url, items: links.map(link => ({link, pubDate: hoursAgo(hours)}))});
const links = (prefix, count) => Array.from({length: count}, (_, i) => `https://www.nbcnews.com/${prefix}/${i}`);

describe('chooseSections', () => {
    it('should keep a section whose recent news the feeds read miss', () => {
        const health = feed('https://www.nbcnews.com/health/rss', links('health', 6));
        expect(chooseSections([health], [])).toEqual([health]);
    });

    it('should leave out a feed bringing again the news already read', () => {
        const all = feed('https://www.nbcnews.com/all/rss', links('news', 10));
        const read = links('news', 8).map(link => link.replace('https://www.', ''));
        expect(chooseSections([all], read)).toEqual([]);
    });

    it('should not take two sections carrying the same news, the one bringing the most first', () => {
        const health = feed('https://www.nbcnews.com/health/rss', links('health', 6));
        const science = feed('https://www.nbcnews.com/science/rss', [...links('health', 6), ...links('science', 2)]);
        const politics = feed('https://www.nbcnews.com/politics/rss', links('politics', 4));
        expect(chooseSections([health, science, politics], []).map(section => section.url))
            .toEqual(['https://www.nbcnews.com/science/rss', 'https://www.nbcnews.com/politics/rss']);
    });

    it('should leave out a feed asleep: its news are not of these days', () => {
        expect(chooseSections([feed('https://www.nbcnews.com/old/rss', links('old', 10), 24 * 30)], [])).toEqual([]);
    });

    it('should leave out a feed holding too many news at once: a flood, or an archive', () => {
        const flood = feed('https://www.nbcnews.com/markets/rss', links('markets', 301));
        const health = feed('https://www.nbcnews.com/health/rss', links('health', 300));
        expect(chooseSections([flood, health], [])).toEqual([health]);
    });
});

describe('sectionCategory', () => {
    it('should read the category in the address of the section, else give none', () => {
        expect(sectionCategory('https://www.nbcnews.com/health/rss')).toBe('science');
        expect(sectionCategory('https://www.lemonde.fr/economie/rss_full.xml')).toBe('economy');
        expect(sectionCategory('https://www.lequipe.fr/rss/actu_rss_Football.xml')).toBe('sport');
        expect(sectionCategory('https://moxie.foxnews.com/google-publisher/latest.xml')).toBeNull();
    });
});

describe('uselessFeeds', () => {
    const daysAgo = (days) => new Date(Date.now() - days * 24 * 3600e3);
    // a feed of the directory as DirectoryModel.usage gives it: three weeks there, 100 news, 5 on an interest
    const row = (fields) => ({url: 'https://www.cedarnews.net/feed', origin: 'named', category: null,
        created_at: daysAgo(21), news: 100, relevant: 5, used: false, ...fields});
    const useless = (rows) => uselessFeeds(rows, {followed: ['sport', 'technology']}).map(feed => feed.url);

    it('should take out a feed whose news are no more on the interests than any news', () => {
        const [feed] = uselessFeeds([row({})], {followed: []});
        expect(feed.reason).toBe('5 of its 100 news of 3 days on an interest, its medium in no briefing of 14 days');
    });

    it('should keep a feed whose medium a briefing used, however few of its news are on an interest', () => {
        expect(useless([row({used: true, relevant: 0})])).toEqual([]);
    });

    it('should keep a feed no briefing used when enough of its news are on an interest', () => {
        expect(useless([row({url: 'https://www.tuttomercatoweb.com/rss', relevant: 18})])).toEqual([]);
    });

    it('should keep a feed without news these days: it costs nothing', () => {
        expect(useless([row({news: 0, relevant: 0})])).toEqual([]);
    });

    it('should give a new feed the time to be used, unless it already floods', () => {
        expect(useless([row({created_at: daysAgo(3)})])).toEqual([]);
        expect(useless([row({created_at: daysAgo(3), news: 4400, relevant: 125})])).toEqual(['https://www.cedarnews.net/feed']);
    });

    it('should keep a new feed that floods with news on the interests: the flood only ends its time to be used', () => {
        expect(useless([row({url: 'https://www.ssbcrack.com/feed', created_at: daysAgo(3), news: 1600, relevant: 240})])).toEqual([]);
    });

    it('should take out a section on a category no profile follows, and keep one on everything', () => {
        const economy = row({url: 'https://www.lesoir.be/economie/rss', origin: 'section', category: 'economy', relevant: 30});
        const all = row({url: 'https://www.lesoir.be/rss', origin: 'section', category: null, relevant: 30});
        const sport = row({url: 'https://www.lesoir.be/sports/rss', origin: 'section', category: 'sport', relevant: 30});
        expect(uselessFeeds([economy, all, sport], {followed: ['sport']})).toEqual([
            expect.objectContaining({url: economy.url, reason: 'a section on economy, which no profile follows'}),
        ]);
    });
});
