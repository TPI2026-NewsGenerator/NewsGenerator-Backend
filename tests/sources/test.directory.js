//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.directory.js
//  Description: The directory of the project: which sections of a medium already read are worth
//               reading, and the category they go to
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {}}));

const {chooseSections, sectionCategory} = await import('../../services/directory-service.js');

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
});

describe('sectionCategory', () => {
    it('should read the category in the address of the section, else give none', () => {
        expect(sectionCategory('https://www.nbcnews.com/health/rss')).toBe('science');
        expect(sectionCategory('https://www.lemonde.fr/economie/rss_full.xml')).toBe('economy');
        expect(sectionCategory('https://www.lequipe.fr/rss/actu_rss_Football.xml')).toBe('sport');
        expect(sectionCategory('https://moxie.foxnews.com/google-publisher/latest.xml')).toBeNull();
    });
});
