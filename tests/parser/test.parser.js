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
        expect(items).toEqual([{title: 'T', thumbnail: null, link: 'https://y', pubDate: null, description: '', category: null, source: null}]);
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
            source: null,
        });
        expect(items[1].category).toBeNull();
    });

    it('should read the publisher of an item (<source url>), used to discover new media', async () => {
        const items = await Parser.Xml(`<rss><channel>
            <item>
                <title>Week 3 referee assignments</title>
                <link>https://news.google.com/rss/articles/CBMi</link>
                <source url="https://www.footballzebras.com">Football Zebras</source>
            </item>
            <item><title>No publisher</title><link>https://x/a</link></item>
        </channel></rss>`);

        expect(items[0].source).toEqual({url: 'https://www.footballzebras.com', name: 'Football Zebras'});
        expect(items[1].source).toBeNull();
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

    // record.pt: "<title>&lt;![CDATA[ Jesus voltou a ajoelhar no Dragão ]]&gt;</title>"
    it('should read a title written as an escaped CDATA section', async () => {
        const items = await Parser.Xml(`<rss><channel><item>
            <title>&lt;![CDATA[ Jesus voltou a ajoelhar no Dragão ]]&gt;</title>
            <description>Ludopédio</description>
            <link>https://x</link>
        </item></channel></rss>`);
        expect(items[0].title).toBe('Jesus voltou a ajoelhar no Dragão');
        expect(items[0].description).toBe('Ludopédio');
    });

    // uol.com.br: no <title>, the title is the description
    it('should take a short description as the title of an item without one', async () => {
        const items = await Parser.Xml(`<rss><channel><item>
            <description><![CDATA[ Flávio vence em 14 estados e no DF; Lula supera em 12 ]]></description>
            <link>https://x</link>
        </item></channel></rss>`);
        expect(items[0].title).toBe('Flávio vence em 14 estados e no DF; Lula supera em 12');
        expect(items[0].description).toBe('');
    });

    it('should cut a long description at a word for the title, and keep it whole', async () => {
        const description = `${'mot '.repeat(39)}fin du titre et bien plus encore`;
        const items = await Parser.Xml(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
            <title></title><link href="https://x/a"/><summary>${description}</summary>
        </entry></feed>`);
        expect(items[0].title).toBe(`${'mot '.repeat(39)}fin…`);
        expect(items[0].title.length).toBeLessThanOrEqual(161);
        expect(items[0].description).toBe(description);
    });

    // the videos of the papers of EBRA (lalsace.fr, dna.fr, leprogres.fr...)
    it('should take the description for a title left as the variable of its template', async () => {
        const items = await Parser.Xml(`<rss><channel>
            <item><title>Vidéo. $content.TitleNoTags</title><description>Ces élus refusent de renommer une école</description><link>https://x/1</link></item>
            <item><title>{{ title }}</title><description>Autre vidéo</description><link>https://x/2</link></item>
            <item><title>Apple's $3.5bn deal: $AAPL.O shares up</title><link>https://x/3</link></item>
        </channel></rss>`);
        expect(items.map(item => item.title)).toEqual(['Ces élus refusent de renommer une école', 'Autre vidéo', "Apple's $3.5bn deal: $AAPL.O shares up"]);
    });

    it('should leave the title empty when there is no description either', async () => {
        const items = await Parser.Xml(`<rss><channel><item><title> </title><link>https://x</link></item></channel></rss>`);
        expect(items[0].title).toBe('');
    });

    it('should return nothing for an unknown format', async () => {
        expect(await Parser.Xml('<html><body>Not a feed</body></html>')).toEqual([]);
    });
});
