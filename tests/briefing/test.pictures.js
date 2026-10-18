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
const {pictureOf} = await import('../../services/briefing-service.js');
const {pageImage} = await import('../../services/utils/crawlers.js');

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
});
