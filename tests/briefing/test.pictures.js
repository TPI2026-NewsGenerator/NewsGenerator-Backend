//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.pictures.js
//  Description: The picture of a card: the one its lead article's feed gave, else the one its page gives
//               to be shared (og:image), else of another of its articles; none when none has one
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
});

describe('pictureOf', () => {
    const lead = {link: 'https://lead.example/a', thumbnail: null};
    const other = {link: 'https://other.example/b', thumbnail: 'https://other.example/b.jpg'};

    it("should take the lead's page picture before another article's feed picture", () => {
        const content = new Map([[lead.link, {thumbnail: 'https://lead.example/og.jpg'}]]);
        expect(pictureOf([lead, other], content)).toEqual({thumbnail: 'https://lead.example/og.jpg', thumbnailSource: 'lead.example'});
    });

    it('should take the picture of another article when the lead has none, and none when none has one', () => {
        expect(pictureOf([lead, other])).toEqual({thumbnail: 'https://other.example/b.jpg', thumbnailSource: 'other.example'});
        expect(pictureOf([lead])).toEqual({thumbnail: null, thumbnailSource: null});
    });
});
