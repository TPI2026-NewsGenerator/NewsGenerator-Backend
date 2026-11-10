//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.illustrations.js
//  Description: The illustration of a card: the picture Wikimedia Commons has of the person, else of the
//               organisation, its articles name; only where none of its articles gives a picture, and
//               last among the pictures the e-mail can take
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const readPictures = jest.fn();
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, readPictures}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {illustrationsOf} = await import('../../services/utils/illustrations.js');
const {withIllustration} = await import('../../services/briefing-service.js');
const {storyPictures} = await import('../../services/utils/mail-pictures.js');
const {briefingMail} = await import('../../services/utils/briefing-mail.js');

// what Commons answers of the files asked: their size, a thumbnail of 1280 px, author and licence
const FILES = {
    'Gianni Infantino 2026.jpg': {width: 3333, height: 5000, artist: '<a href="//commons.wikimedia.org/wiki/User:Ph">Ph</a>', license: 'CC BY-SA 4.0'},
    'Siège UEFA Nyon (Suisse).JPG': {width: 2048, height: 1536, artist: 'Someone', license: 'CC BY-SA 3.0'},
    'Tiny face.jpg': {width: 300, height: 400, artist: 'X', license: 'CC0'},
};
const commons = (url) => {
    const titles = new URL(url).searchParams.get('titles').split('|');
    const pages = Object.fromEntries(titles.map((title, i) => {
        const file = FILES[title.replace(/^File:/, '')];
        return [String(-i - 1), file ? {title, imageinfo: [{width: file.width, height: file.height,
            thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}/1280px.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/${title}`,
            extmetadata: {Artist: {value: file.artist}, LicenseShortName: {value: file.license}}}]} : {title, missing: ''}];
    }));
    return {ok: true, json: async () => ({query: {pages}})};
};

beforeEach(() => {
    readPictures.mockReset();
    global.fetch = jest.fn(async (url) => commons(url));
});

describe('illustrationsOf', () => {
    it('should take the picture of the person named before the one of an organisation, credited to its author', async () => {
        readPictures.mockResolvedValue(new Map([['Q1', 'Gianni Infantino 2026.jpg'], ['Q2', 'Siège UEFA Nyon (Suisse).JPG']]));
        const found = await illustrationsOf(new Map([[7, [{name: 'UEFA', qid: 'Q2', kind: 'organization'}, {name: 'Gianni Infantino', qid: 'Q1', kind: 'person'}]],
            [8, [{name: 'UEFA', qid: 'Q2', kind: 'organization'}]]]));
        expect(found.get(7)).toMatchObject({name: 'Gianni Infantino', width: 3333, height: 5000, credit: 'Wikimedia Commons · Ph, CC BY-SA 4.0'});
        expect(found.get(7).url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
        expect(found.get(8)).toMatchObject({name: 'UEFA', credit: 'Wikimedia Commons · Someone, CC BY-SA 3.0'});
    });

    it('should leave out a picture too small, a drawing, a name of no item, and ask nothing without a name', async () => {
        readPictures.mockResolvedValue(new Map([['Q3', 'Tiny face.jpg'], ['Q4', 'Coat of arms.svg']]));
        const found = await illustrationsOf(new Map([[1, [{name: 'Someone', qid: 'Q3', kind: 'person'}, {name: 'A town', qid: 'Q4', kind: 'organization'},
            {name: 'Nobody', qid: null, kind: 'person'}]]]));
        expect(found.size).toBe(0);
        expect(new URL(global.fetch.mock.calls[0][0]).searchParams.get('titles')).toBe('File:Tiny face.jpg');

        global.fetch.mockClear();
        expect((await illustrationsOf(new Map([[1, []]]))).size).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('the illustration of a card', () => {
    const illustration = {url: 'https://upload.wikimedia.org/infantino.jpg', width: 3333, height: 5000, credit: 'Wikimedia Commons · Ph, CC BY-SA 4.0'};

    it('should be the picture of a card only when none of its articles gives one', () => {
        expect(withIllustration({thumbnail: 'https://media.fr/a.jpg', thumbnailSource: 'media.fr'}, illustration))
            .toEqual({thumbnail: 'https://media.fr/a.jpg', thumbnailSource: 'media.fr'});
        expect(withIllustration({thumbnail: null, thumbnailSource: null}, illustration))
            .toEqual({thumbnail: illustration.url, thumbnailSource: illustration.credit});
        expect(withIllustration({thumbnail: null, thumbnailSource: null}, undefined)).toEqual({thumbnail: null, thumbnailSource: null});
    });

    it('should come last among the pictures of the story, marked as one', () => {
        const item = {thumbnail: illustration.url, thumbnailSource: illustration.credit, illustration, lead: {url: 'https://kicker.de/1', source: 'kicker.de'}};
        expect(storyPictures(item, [{link: 'https://kicker.de/1', thumbnail: 'https://kicker.de/small.jpg'}])).toEqual([
            {url: 'https://kicker.de/small.jpg', source: 'kicker.de'},
            {url: illustration.url, source: illustration.credit, illustration: true},
        ]);
    });

    it('should be said an illustration in the e-mail, a standing one no higher than 420 px', () => {
        const card = {storyId: 1, title: 'Infantino', summary: 'A passage.', thumbnail: illustration.url, thumbnailSource: illustration.credit, illustration};
        const {html} = briefingMail({items: [card]});
        expect(html).toContain('Illustration — Wikimedia Commons · Ph, CC BY-SA 4.0');
        expect(html).toContain('width="280"');
        // the picture of an article stays a picture, 560 px wide
        const {html: own} = briefingMail({items: [{...card, thumbnail: 'https://media.fr/a.jpg', thumbnailSource: 'media.fr'}]});
        expect(own).toContain('Picture — media.&#8203;fr');
        expect(own).toContain('width="560"');
    });

    it('should show a standing picture of an article no higher than 420 px too, as the card was written with its size (10.11.2026)', () => {
        const card = {storyId: 1, title: 'A news', summary: 'A passage.', thumbnail: 'https://media.fr/portrait.jpg', thumbnailSource: 'media.fr',
            pictures: [{url: 'https://media.fr/wide.jpg', width: 1600, height: 900}, {url: 'https://media.fr/portrait.jpg', source: 'media.fr', width: 800, height: 1200}]};
        expect(briefingMail({items: [card]}).html).toContain('width="280"');
        // a wide one, one whose size is not known (a card of before the sizes) and one the reader joined stay 560 px
        for (const thumbnail of ['https://media.fr/wide.jpg', 'https://media.fr/other.jpg', 'cid:picture-1@newsgenerator']) {
            expect(briefingMail({items: [{...card, thumbnail}]}).html).toContain('width="560"');
        }
        expect(briefingMail({items: [{...card, pictures: undefined}]}).html).toContain('width="560"');
    });

    describe('a standing picture cut to a landscape in the e-mail (10.11.2026)', () => {
        const standing = (size) => ({storyId: 1, title: 'A news', summary: 'A passage.', thumbnail: 'https://media.fr/portrait.jpg', thumbnailSource: 'media.fr',
            pictures: [{url: 'https://media.fr/portrait.jpg', source: 'media.fr', ...size}]});
        const MSO = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/;

        it('should put a standing picture in a box 56.25% as high as it is wide, the picture pulled up by 12% of what overflows, for the apps that know it', () => {
            const {html} = briefingMail({items: [standing({width: 800, height: 1200})]});
            const box = html.split('<!--[if !mso]><!-->')[1].split('<!--<![endif]-->')[0];
            expect(box).toContain('height:0;padding-bottom:56.25%;overflow:hidden;border-radius:18px');
            // 2:3: the picture is 1.5 times its width high, 0.9375 of it overflows the box: 12% of that, in % of the width
            expect(box).toContain('margin:-11.25% 0 0');
            expect(box).toContain('width="560"');
            expect(box).toContain('max-width:560px');
        });

        it('should give Outlook of Windows the narrow picture of before, which does not know the crop', () => {
            const {html} = briefingMail({items: [standing({width: 800, height: 1200})]});
            const narrow = html.match(MSO)[1];
            expect(narrow).toContain('width="280"');
            expect(narrow).toContain('max-width:280px');
            expect(narrow).not.toContain('overflow');
        });

        it('should pull up a less standing picture by less: 3:4 by 9.25%', () => {
            expect(briefingMail({items: [standing({width: 900, height: 1200})]}).html).toContain('margin:-9.25% 0 0');
        });

        it('should not cut a picture that is wide, nearly square, or of no known size: they keep their one picture', () => {
            for (const size of [{width: 1600, height: 900}, {width: 1000, height: 1000}, {width: 1000, height: 1050}, {}]) {
                const {html} = briefingMail({items: [standing(size)]});
                expect(html).not.toContain('<!--[if mso]>');
                expect(html).not.toContain('padding-bottom:56.25%');
            }
            // a near-square one taller than wide keeps its cap
            expect(briefingMail({items: [standing({width: 1000, height: 1050})]}).html).toContain('width="400"');
        });

        it('should show the same picture in both, and its credit once, under it', () => {
            const {html} = briefingMail({items: [standing({width: 800, height: 1200})]});
            expect(html.match(/https:\/\/media\.fr\/portrait\.jpg/g)).toHaveLength(2);
            expect(html.match(/Picture — /g)).toHaveLength(1);
        });
    });
});
