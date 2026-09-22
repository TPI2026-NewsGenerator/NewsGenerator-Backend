//
//  Author: Fabian Rostello
//  Date: 22.09.2026
//  File: test.parser.js
//  Description: Tests for the RSS 2.0, RDF (RSS 1.0) and Atom parser
//

import {Parser} from '../../services/utils/parser.js'
import {rssFeed} from '../mock/rss-feed.js'

describe('Parser.Xml', () => {
    it('should read an RSS 2.0 feed', async () => {
        const items = await Parser.Xml(rssFeed);
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].title).toBe('Officials Pressed Schumer to Help Name Penn Station and Dulles Airport for Trump');
        expect(items[0].link).toMatch(/^https:\/\/www\.nytimes\.com\//);
        expect(items[0].thumbnail).toMatch(/^https:\/\/static01\.nyt\.com\//);
        expect(Array.isArray(items[0].category)).toBe(true);
    });

    it('should read an RSS 2.0 feed with only one item', async () => {
        const items = await Parser.Xml(`<rss><channel><item><title> T </title><link>https://y</link></item></channel></rss>`);
        expect(items).toEqual([{title: 'T', thumbnail: null, link: 'https://y', pubDate: null, description: '', category: null}]);
    });

    it('should read an RDF (RSS 1.0) feed, items next to the channel', async () => {
        const items = await Parser.Xml(`<?xml version="1.0"?>
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
                <channel rdf:about="https://dw.com/feed"><title>DW Sports</title></channel>
                <item rdf:about="https://dw.com/a-1">
                    <title>Could we see MMA at the Olympics?</title>
                    <link>https://dw.com/a-1</link>
                    <description>Mixed martial arts has made its debut.</description>
                    <dc:date>2026-09-22T12:14:00Z</dc:date>
                    <dc:subject>Sports</dc:subject>
                </item>
                <item rdf:about="https://dw.com/a-2">
                    <title>Second</title>
                    <link>https://dw.com/a-2</link>
                </item>
            </rdf:RDF>`);

        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            title: 'Could we see MMA at the Olympics?',
            thumbnail: null,
            link: 'https://dw.com/a-1',
            pubDate: '2026-09-22T12:14:00Z',
            description: 'Mixed martial arts has made its debut.',
            category: ['Sports'],
        });
        expect(items[1].category).toBeNull();
    });

    it('should read an Atom feed', async () => {
        const items = await Parser.Xml(`<feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
                <title type="html">Hello</title>
                <link rel="alternate" href="https://x/a"/>
                <published>2026-01-01</published>
                <summary>S</summary>
                <category term="Politics"/>
            </entry>
        </feed>`);
        expect(items).toEqual([{title: 'Hello', thumbnail: null, link: 'https://x/a', pubDate: '2026-01-01', description: 'S', category: ['Politics']}]);
    });

    it('should decode the HTML entities of the titles and descriptions', async () => {
        const items = await Parser.Xml(`<rss><channel><item>
            <title>Fed&#x2019;s Barkin &amp; the &#8212; rate</title>
            <description>caf&#233; &amp; croissant</description>
            <link>https://x</link>
        </item></channel></rss>`);
        expect(items[0].title).toBe("Fed’s Barkin & the — rate");
        expect(items[0].description).toBe('café & croissant');
    });

    it('should decode entities encoded twice by some feeds', async () => {
        const items = await Parser.Xml(`<rss><channel><item>
            <title>Apple&amp;#8217;s keyboard</title>
            <link>https://x</link>
        </item></channel></rss>`);
        expect(items[0].title).toBe("Apple’s keyboard");
    });

    it('should remove the HTML of the descriptions', async () => {
        const items = await Parser.Xml(`<rss><channel><item>
            <title>La Liga president speaks</title>
            <description>&lt;ul&gt;&lt;li&gt;&lt;p&gt;The competition belongs to no one&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Javier Tebas hit out &lt;a href="https://x"&gt;on Tuesday&lt;/a&gt;.&lt;/p&gt;</description>
            <link>https://x</link>
        </item></channel></rss>`);
        expect(items[0].description).toBe('The competition belongs to no one Javier Tebas hit out on Tuesday .');
    });

    it('should return nothing for an unknown format', async () => {
        expect(await Parser.Xml('<html><body>Not a feed</body></html>')).toEqual([]);
    });
});
