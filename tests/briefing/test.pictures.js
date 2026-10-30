//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.pictures.js
//  Description: The picture of a card: the one its lead article's page gives to be shared (og:image),
//               else the one its feed gave, else of another of its articles; none when none has one
//

import {describe, expect, it, jest} from '@jest/globals';
import {parseHTML} from 'linkedom';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {candidatePictures, pictureOf} = await import('../../services/briefing-service.js');
const {pageImage} = await import('../../services/utils/crawlers.js');
const {storyPictures} = await import('../../services/utils/mail-pictures.js');

const page = (head) => parseHTML(`<!doctype html><html><head>${head}</head><body><p>Text</p></body></html>`).document;

describe('pageImage', () => {
    it('should read the picture a page gives to be shared, as an absolute address', () => {
        expect(pageImage(page('<meta property="og:image" content="https://cdn.example/a.jpg">'), 'https://www.example/a')).toBe('https://cdn.example/a.jpg');
        expect(pageImage(page('<meta name="twitter:image" content="/img/b.png">'), 'https://www.example/news/b')).toBe('https://www.example/img/b.png');
    });

    it('should give none for a page without one, or with no address of the web', () => {
        expect(pageImage(page('<title>T</title>'), 'https://www.example/a')).toBeNull();
        expect(pageImage(page('<meta property="og:image" content="data:image/png;base64,AAAA">'), 'https://www.example/a')).toBeNull();
    });

    it("should leave out the picture a site gives its pages without one, never its news'", () => {
        expect(pageImage(page('<meta property="og:image" content="https://storage.livescore.com/images/web/medium/news_article_default_image_4.jpg">'), 'https://www.livescore.com/a')).toBeNull();
        expect(pageImage(page('<meta property="og:image" content="https://cdn.example/static/logo.png"><meta name="twitter:image" content="https://cdn.example/news/a.jpg">'), 'https://www.example/a'))
            .toBe('https://cdn.example/news/a.jpg');
        expect(pageImage(page('<meta property="og:image" content="https://cdn.example/2026/10/banks-defaulting-on-loans.jpg">'), 'https://www.example/a'))
            .toBe('https://cdn.example/2026/10/banks-defaulting-on-loans.jpg');
    });
});

describe('pageImage and the structured data of a page', () => {
    const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
    const livescore = '<meta property="og:image" content="https://storage.lsmedia1.com/images/web/medium/news_article_default_image_3.jpg">';

    it("should take the photo of the news in its JSON-LD when the page gives a generic one to be shared (30.10.2026)", () => {
        const photo = 'https://assets.goal.com/images/v3/getty-2291494033/crop/AAA/GettyImages-2291494033.jpg';
        expect(pageImage(page(livescore + ld({'@context': 'https://schema.org', '@type': 'NewsArticle', headline: 'H', image: photo})), 'https://www.livescore.com/a')).toBe(photo);
    });

    it('should read an image that is a list, an object, or in a graph, of an article only', () => {
        expect(pageImage(page(ld({'@type': 'NewsArticle', image: [{'@type': 'ImageObject', url: 'https://cdn.example/1.jpg'}]})), 'https://www.example/a')).toBe('https://cdn.example/1.jpg');
        expect(pageImage(page(ld({'@graph': [{'@type': 'Organization', logo: 'https://cdn.example/x.png', image: 'https://cdn.example/org.jpg'},
            {'@type': ['WebPage', 'Article'], image: '/photos/2.jpg'}]})), 'https://www.example/news/a')).toBe('https://www.example/photos/2.jpg');
        // not an article: none
        expect(pageImage(page(ld({'@type': 'Organization', image: 'https://cdn.example/org.jpg'})), 'https://www.example/a')).toBeNull();
    });

    it('should keep the picture to be shared when it is of the news, and survive data that is not JSON', () => {
        expect(pageImage(page('<meta property="og:image" content="https://cdn.example/og.jpg">' + ld({'@type': 'NewsArticle', image: 'https://cdn.example/ld.jpg'})), 'https://www.example/a'))
            .toBe('https://cdn.example/og.jpg');
        expect(pageImage(page('<script type="application/ld+json">{ not json</script>'), 'https://www.example/a')).toBeNull();
        expect(pageImage(page(ld({'@type': 'NewsArticle', image: 'https://cdn.example/default-news.jpg'})), 'https://www.example/a')).toBeNull();
    });
});

describe('pictureOf', () => {
    const lead = {link: 'https://lead.example/a', thumbnail: null};
    const other = {link: 'https://other.example/b', thumbnail: 'https://other.example/b.jpg'};

    it("should take the lead's page picture before another article's feed picture", () => {
        const content = new Map([[lead.link, {thumbnail: 'https://lead.example/og.jpg'}]]);
        expect(pictureOf([lead, other], content)).toEqual({thumbnail: 'https://lead.example/og.jpg', thumbnailSource: 'lead.example'});
    });

    it("should take an article's page picture before the one its feed gave, a thumbnail often", () => {
        const fed = {link: 'https://lead.example/a', thumbnail: 'https://lead.example/a-150x150.jpg'};
        const content = new Map([[fed.link, {thumbnail: 'https://lead.example/a-1200.jpg'}]]);
        expect(pictureOf([fed], content)).toEqual({thumbnail: 'https://lead.example/a-1200.jpg', thumbnailSource: 'lead.example'});
        expect(pictureOf([fed])).toEqual({thumbnail: 'https://lead.example/a-150x150.jpg', thumbnailSource: 'lead.example'});
    });

    it('should take the picture of another article when the lead has none, and none when none has one', () => {
        expect(pictureOf([lead, other])).toEqual({thumbnail: 'https://other.example/b.jpg', thumbnailSource: 'other.example'});
        expect(pictureOf([lead])).toEqual({thumbnail: null, thumbnailSource: null});
    });

    it("should take another article's https picture before the lead's http one, a browser blocks it (29.10.2026)", () => {
        const plain = {link: 'http://lead.example/a', thumbnail: 'http://phototw.lead.example/a.jpg'};
        expect(pictureOf([plain, other])).toEqual({thumbnail: 'https://other.example/b.jpg', thumbnailSource: 'other.example'});
        const content = new Map([[plain.link, {thumbnail: 'https://lead.example/og.jpg'}]]);
        expect(pictureOf([plain, other], content)).toEqual({thumbnail: 'https://lead.example/og.jpg', thumbnailSource: 'lead.example'});
    });

    it('should keep an http picture when no article has an https one', () => {
        const plain = {link: 'http://lead.example/a', thumbnail: 'http://phototw.lead.example/a.jpg'};
        expect(pictureOf([plain, lead])).toEqual({thumbnail: 'http://phototw.lead.example/a.jpg', thumbnailSource: 'lead.example'});
    });

    describe('with the size of the pictures (29.10.2026)', () => {
        const feeds = [
            {link: 'https://a.example/1', thumbnail: 'https://a.example/small.jpg'},
            {link: 'https://b.example/2', thumbnail: 'https://b.example/big.jpg'},
            {link: 'https://c.example/3', thumbnail: 'https://c.example/wide.jpg'},
        ];
        const size = (width) => ({width, height: Math.round(width * 9 / 16)});

        it('should take the first picture sharp enough, not the first one', () => {
            const sizes = new Map([['https://a.example/small.jpg', size(180)], ['https://b.example/big.jpg', size(1200)], ['https://c.example/wide.jpg', size(1600)]]);
            expect(pictureOf(feeds, new Map(), sizes)).toEqual({thumbnail: 'https://b.example/big.jpg', thumbnailSource: 'b.example'});
        });

        it('should leave out a picture that does not load, and the page picture that does not before the feed one', () => {
            const sizes = new Map([['https://a.example/small.jpg', null], ['https://b.example/big.jpg', null], ['https://c.example/wide.jpg', size(900)]]);
            expect(pictureOf(feeds, new Map(), sizes).thumbnail).toBe('https://c.example/wide.jpg');
            const og = new Map([[feeds[0].link, {thumbnail: 'https://a.example/og-dead.jpg'}]]);
            expect(pictureOf([feeds[0]], og, new Map([['https://a.example/og-dead.jpg', null], ['https://a.example/small.jpg', size(700)]])).thumbnail)
                .toBe('https://a.example/small.jpg');
            expect(pictureOf(feeds, new Map(), new Map(feeds.map(feed => [feed.thumbnail, null])))).toEqual({thumbnail: null, thumbnailSource: null});
        });

        it('should take a picture not measured before one too small, and the widest of the too small ones', () => {
            const sizes = new Map([['https://a.example/small.jpg', size(180)], ['https://c.example/wide.jpg', size(300)]]);
            expect(pictureOf(feeds, new Map(), sizes).thumbnail).toBe('https://b.example/big.jpg');
            const small = new Map(feeds.map((feed, i) => [feed.thumbnail, size([180, 300, 250][i])]));
            expect(pictureOf(feeds, new Map(), small).thumbnail).toBe('https://b.example/big.jpg');
        });

        it('should take a sharp picture on http only after the ones on https, even small ones', () => {
            const plain = {link: 'http://a.example/1', thumbnail: 'http://a.example/big.jpg'};
            const sizes = new Map([['http://a.example/big.jpg', size(1600)], ['https://b.example/big.jpg', size(300)]]);
            expect(pictureOf([plain, feeds[1]], new Map(), sizes).thumbnail).toBe('https://b.example/big.jpg');
        });
    });
});

describe('candidatePictures', () => {
    it("should list the page picture then the feed picture of each article, each address once", () => {
        const articles = [{link: 'https://a.example/1', thumbnail: 'https://a.example/feed.jpg'}, {link: 'https://b.example/2', thumbnail: 'https://a.example/feed.jpg'}, {link: 'https://c.example/3', thumbnail: null}];
        const content = new Map([['https://a.example/1', {thumbnail: 'https://a.example/og.jpg'}], ['https://c.example/3', {thumbnail: 'https://c.example/og.jpg'}]]);
        expect(candidatePictures(articles, content).map(picture => picture.thumbnail))
            .toEqual(['https://a.example/og.jpg', 'https://a.example/feed.jpg', 'https://c.example/og.jpg']);
    });
});

describe('storyPictures', () => {
    it('should offer the pictures measured when the card was written, after its own and before the feeds', () => {
        const item = {thumbnail: 'https://a.example/own.jpg', thumbnailSource: 'a.example', lead: {url: 'https://a.example/1', source: 'a.example'}, articles: [],
            pictures: [{url: 'https://a.example/own.jpg', source: 'a.example', width: 1200, height: 675}, {url: 'https://b.example/og.jpg', source: 'b.example', width: 900, height: 600}]};
        expect(storyPictures(item, [{link: 'https://c.example/3', thumbnail: 'https://c.example/feed.jpg'}]).map(picture => picture.url))
            .toEqual(['https://a.example/own.jpg', 'https://b.example/og.jpg', 'https://c.example/feed.jpg']);
    });

    it('should work for a card written before the sizes were measured', () => {
        const item = {thumbnail: 'https://a.example/own.jpg', thumbnailSource: 'a.example', lead: null, articles: []};
        expect(storyPictures(item, []).map(picture => picture.url)).toEqual(['https://a.example/own.jpg']);
    });
});
