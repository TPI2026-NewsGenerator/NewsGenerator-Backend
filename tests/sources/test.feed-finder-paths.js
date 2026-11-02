//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.feed-finder-paths.js
//  Description: The usual paths of a site that declares no feed (or none that answers): with the slash of
//               WordPress, where the site lives after its redirect, and tried when the declared feeds are dead
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

// what the mocked network answers: the page of an address (its html, and the address it ends on after
// its redirects), the feeds that answer with news (their address and the days since their news), and
// the feeds the directory knows
let pages = {};
let live = new Map();
let directory = [];
const fetchPublicUrl = jest.fn(async (url) => {
    const page = pages[url];
    return page
        ? {res: {ok: true, text: async () => page.html}, url: page.url ?? url}
        : {res: {ok: false, status: 404}, url};
});
const readFeeds = jest.fn(async (feeds) => feeds.map(({url}) => ({url, items: live.has(url)
    ? [1, 2, 3].map(n => ({title: `News ${n}`, link: `${url}#${n}`, pubDate: new Date(Date.now() - live.get(url) * 864e5).toUTCString()}))
    : []})));
const answering = (...urls) => new Map(urls.map(url => [url, 0]));

jest.unstable_mockModule('../../services/utils/public-url.js', () => ({
    assertPublicUrl: async (value) => new URL(value),
    fetchPublicUrl,
    discardBody: async () => {},
    readText: async (res) => res.text(),
    hostOf: (value) => {
        try {
            return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    },
    isBridgeUrl: () => false,
    nameOf: (host) => host.split('.').slice(-2)[0],
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Xml: readFeeds}}));
jest.unstable_mockModule('../../services/utils/feed-directory.js', () => ({searchDirectory: jest.fn(async () => directory)}));
jest.unstable_mockModule('../../services/utils/feed-bridge.js', () => ({bridgeFeed: jest.fn(async () => null)}));

const {findFeeds} = await import('../../services/utils/feed-finder.js');

const asked = () => readFeeds.mock.calls.flatMap(([feeds]) => feeds.map(({url}) => url));
const declaring = (...urls) => `<html><head>${urls.map(url => `<link rel="alternate" type="application/rss+xml" href="${url}">`).join('')}</head></html>`;

beforeEach(() => {
    pages = {};
    live = new Map();
    directory = [];
    fetchPublicUrl.mockClear();
    readFeeds.mockClear();
});

describe('findFeeds on the usual paths', () => {
    it('should find the feed a site serves with its slash only', async () => {
        pages = {'https://ahoraeg.example/': {html: '<html></html>'}};
        live = answering('https://ahoraeg.example/feed/');

        const feeds = await findFeeds('https://ahoraeg.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://ahoraeg.example/feed/']);
    });

    it('should try the paths where the site lives after its redirect, not where the list named it', async () => {
        pages = {'https://iraqinews.example/': {html: '<html></html>', url: 'https://www.iraqinews.example/'}};
        live = answering('https://www.iraqinews.example/feed/');

        const feeds = await findFeeds('https://iraqinews.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://www.iraqinews.example/feed/']);
        expect(asked().every(url => url.startsWith('https://www.iraqinews.example/'))).toBe(true);
    });

    it('should try the usual paths when the feeds the page declares do not answer', async () => {
        pages = {'https://cook.example/': {html: declaring('https://cook.example/home/feed/', 'https://cook.example/wp-json/oembed/1.0/embed?format=xml')}};
        live = answering('https://cook.example/feed');

        const feeds = await findFeeds('https://cook.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://cook.example/feed']);
        // the declared ones are read once, then the usual paths without them
        expect(asked().filter(url => url === 'https://cook.example/home/feed/')).toHaveLength(1);
    });

    it('should not read the usual paths when a declared feed answers', async () => {
        pages = {'https://club.example/': {html: declaring('https://club.example/news.xml')}};
        live = answering('https://club.example/news.xml', 'https://club.example/feed');

        const feeds = await findFeeds('https://club.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://club.example/news.xml']);
        expect(readFeeds).toHaveBeenCalledTimes(1);
    });

    it('should give no feed when neither the page nor the usual paths have one', async () => {
        pages = {'https://empty.example/': {html: declaring('https://empty.example/dead.xml')}};

        expect(await findFeeds('https://empty.example/', {bridge: false})).toEqual([]);
    });
});

describe('findFeeds on a site whose bare domain refuses the page', () => {
    it('should read the site on www. when the bare domain is dead and www. answers', async () => {
        pages = {'https://enab.example/': undefined, 'https://www.enab.example/': {html: '<html></html>'}};
        live = answering('https://www.enab.example/feed/');

        const feeds = await findFeeds('https://enab.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://www.enab.example/feed/']);
    });

    it('should keep to the bare domain when www. is dead too: its feed may answer where its page does not', async () => {
        live = answering('https://khaosod.example/feed');

        const feeds = await findFeeds('https://khaosod.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://khaosod.example/feed']);
    });

    it('should try the usual paths of www. as well when its page is refused too, and give no feed when neither has one', async () => {
        live = answering('https://www.iraq.example/feed/');

        const feeds = await findFeeds('https://iraq.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://www.iraq.example/feed/']);
        expect(asked().filter(url => url === 'https://iraq.example/feed/')).toHaveLength(1);
        expect(await findFeeds('https://nothing.example/', {bridge: false})).toEqual([]);
    });

    it('should not try www. in front of an address that has it already, nor when the bare page answers', async () => {
        pages = {'https://www.dead.example/': undefined, 'https://club.example/': {html: '<html></html>'}};

        await findFeeds('https://www.dead.example/', {bridge: false});
        await findFeeds('https://club.example/', {bridge: false});

        const read = fetchPublicUrl.mock.calls.map(([url]) => url);
        expect(read.filter(url => url.includes('www.www.'))).toEqual([]);
        expect(read).not.toContain('https://www.club.example/');
    });
});

describe('findFeeds on a feed that is asleep', () => {
    it('should look at the usual paths and the directory, and give the feed with the most news first', async () => {
        pages = {'https://sdna.example/': {html: declaring('https://sdna.example/rss.xml')}};
        // the feed the page declares has no news of the week, the one the directory knows has
        live = new Map([['https://sdna.example/rss.xml', 30], ['https://sdna.example/latest.xml', 0]]);
        directory = [{url: 'https://sdna.example/latest.xml'}];

        const feeds = await findFeeds('https://sdna.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://sdna.example/latest.xml', 'https://sdna.example/rss.xml']);
    });

    it('should keep the sleeping feed when nothing better is found, without reading it twice', async () => {
        pages = {'https://quiet.example/': {html: declaring('https://quiet.example/feed.xml')}};
        live = new Map([['https://quiet.example/feed.xml', 30]]);

        const feeds = await findFeeds('https://quiet.example/', {bridge: false});

        expect(feeds.map(feed => feed.url)).toEqual(['https://quiet.example/feed.xml']);
        expect(asked().filter(url => url === 'https://quiet.example/feed.xml')).toHaveLength(1);
    });

    it('should not look further when the feed has news of the week', async () => {
        pages = {'https://busy.example/': {html: declaring('https://busy.example/feed.xml')}};
        live = answering('https://busy.example/feed.xml');

        await findFeeds('https://busy.example/', {bridge: false});

        expect(readFeeds).toHaveBeenCalledTimes(1);
    });
});
