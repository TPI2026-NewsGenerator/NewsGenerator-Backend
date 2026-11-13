//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: test.junk-links.js
//  Description: The pages a feed gives that are not news (junk-links.js): the edits of a wiki (a comparison of two versions, a page of a user, the recent changes) and the feeds of them, and what
//               is left alone: an article of a wiki, Wikinews, any other site
//

import {describe, expect, it} from '@jest/globals';
import {isWikiEditFeed, isWikiEditLink} from '../../services/utils/junk-links.js';

describe('isWikiEditLink', () => {
    it('should find the page of the comparison of two versions of a page, the card of the briefing of 13.11.2026', () => {
        const diff = 'https://el.wikipedia.org/w/index.php?title=%CE%9D%CE%AC%CF%83%CE%B9%CE%BF%CE%BD%CE%B1%CE%BB_%CE%9B%CE%B9%CE%B3%CE%BA_(%CE%B1%CE%B3%CE%B3%CE%BB%CE%B9%CE%BA%CF%8C_%CF%80%CE%BF%CE%B4%CF%8C%CF%83%CF%86%CE%B1%CE%B9%CF%81%CE%BF)&diff=11919453&oldid=10428275';
        expect(isWikiEditLink(diff)).toBe(true);
        expect(isWikiEditLink('https://en.wikipedia.org/w/index.php?title=FIFA&oldid=1234567')).toBe(true);
        expect(isWikiEditLink('https://en.wikipedia.org/w/index.php?title=FIFA&action=history')).toBe(true);
        expect(isWikiEditLink('https://fr.wikipedia.org/w/index.php?diff=prev&oldid=222')).toBe(true);
    });

    it('should find the pages of a namespace, in any language: a user, a talk, a special page', () => {
        expect(isWikiEditLink('https://el.wikipedia.org/wiki/%CE%A7%CF%81%CE%AE%CF%83%CF%84%CE%B7%CF%82:BlueOlive2026')).toBe(true);
        expect(isWikiEditLink('https://el.wikipedia.org/wiki/Χρήστης:Kalogeni_25')).toBe(true);
        expect(isWikiEditLink('https://en.wikipedia.org/wiki/User_talk:Someone')).toBe(true);
        expect(isWikiEditLink('https://en.wikipedia.org/wiki/Special:RecentChanges')).toBe(true);
        expect(isWikiEditLink('https://en.wikipedia.org/w/index.php?title=Special:NewPages')).toBe(true);
        expect(isWikiEditLink('https://fr.wiktionary.org/wiki/Utilisateur:Quelquun')).toBe(true);
    });

    it('should leave alone an article, whatever its title, and a page of an index.php that is an article', () => {
        for (const link of ['https://en.wikipedia.org/wiki/FIFA', 'https://el.wikipedia.org/wiki/%CE%A0%CE%BF%CE%B4%CF%8C%CF%83%CF%86%CE%B1%CE%B9%CF%81%CE%BF',
            'https://en.wikipedia.org/wiki/Star_Wars:_Episode_I_%E2%80%93_The_Phantom_Menace', 'https://en.wikipedia.org/wiki/Paris_Saint-Germain_F.C.',
            'https://en.wikipedia.org/w/index.php?title=FIFA', 'https://en.wikipedia.org/w/index.php?title=Star_Wars:_Episode_I']) {
            expect([link, isWikiEditLink(link)]).toEqual([link, false]);
        }
    });

    it('should leave alone Wikinews, which is news, any other site that looks like a wiki, and what is no address', () => {
        for (const link of ['https://en.wikinews.org/wiki/User:Someone', 'https://www.bbc.com/sport/football/articles/c0123', 'https://news.example.com/w/index.php?diff=1&oldid=2',
            'https://wiki.example.org/wiki/User:Someone', '', null, undefined, 'not an address']) {
            expect([link, isWikiEditLink(link)]).toEqual([link, false]);
        }
    });
});

describe('isWikiEditFeed', () => {
    it('should find the feed of the recent changes of a wiki, the history of a page, the new pages, whatever the language', () => {
        expect(isWikiEditFeed('https://el.wikipedia.org/w/index.php?title=Ειδικό:ΠρόσφατεςΑλλαγές&feed=atom')).toBe(true);
        expect(isWikiEditFeed('https://el.wikipedia.org/w/index.php?title=%CE%95%CE%B9%CE%B4%CE%B9%CE%BA%CF%8C:%CE%A0%CF%81%CF%8C%CF%83%CF%86%CE%B1%CF%84%CE%B5%CF%82&feed=atom')).toBe(true);
        expect(isWikiEditFeed('https://en.wikipedia.org/w/index.php?title=Special:NewPages&feed=atom')).toBe(true);
        expect(isWikiEditFeed('https://en.wikipedia.org/w/index.php?title=FIFA&action=history&feed=rss')).toBe(true);
        expect(isWikiEditFeed('https://en.wikipedia.org/w/api.php?action=feedrecentchanges&feedformat=atom')).toBe(true);
    });

    it('should leave alone the feed of Wikinews, a feed of any other site, and what is no address', () => {
        for (const url of ['https://en.wikinews.org/w/index.php?title=Special:NewsFeed&feed=atom', 'https://www.bbc.co.uk/sport/football/rss.xml', 'https://example.com/w/index.php?feed=atom',
            'https://en.wikipedia.org/wiki/FIFA', 'https://en.wikipedia.org/w/index.php?title=FIFA', 'https://en.wikipedia.org/w/api.php?action=query', '', null, 'not an address']) {
            expect([url, isWikiEditFeed(url)]).toEqual([url, false]);
        }
    });
});
