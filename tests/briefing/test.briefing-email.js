//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.briefing-email.js
//  Description: The cards of a briefing the reader ticked sent by e-mail, to the address of the account
//               or to the one they write, in the order they gave, laid out as the page shows them
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const sendMail = jest.fn(async () => {});
const articlePictures = jest.fn(async () => [
    {link: 'https://kicker.de/1', thumbnail: 'https://93.184.215.14/kicker.jpg'},
    {link: 'https://media.fr/2', thumbnail: 'https://93.184.215.14/card.jpg'},
    {link: 'https://other.example/3', thumbnail: 'javascript:alert(1)'},
]);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, articlePictures}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test', username: 'lecteur'}))}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async () => ({name: 'Football'}))}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({sendMail, mailEnabled: () => true}));
const {BriefingService} = await import('../../services/briefing-service.js');
const {briefingMail} = await import('../../services/utils/briefing-mail.js');

const card = (storyId, title, changes = {}) => ({
    storyId, title, summary: `Passage of ${title}.\n\nAnother passage.`, topic: 'sport', language: 'en',
    lead: {source: 'media.fr', url: `https://media.fr/${storyId}`, language: 'fr'}, articles: [],
    corroboration: {media: 3, read: 3, independent: 2, agencies: []}, ...changes,
});
const row = {
    id: 7, status: 'ready', id_profile: 3, hours: 24, created_at: new Date('2026-10-08T06:00:00Z'), finished_at: new Date('2026-10-08T06:01:00Z'),
    items: [card(1, 'First story'), card(2, 'Second story'), card(3, 'Third story')],
    watched: [{term: 'VAR', count: 1, news: [{title: 'A VAR news', url: 'https://x/var', source: 'x'}]}],
};

beforeEach(() => {
    ofUser.mockReset().mockResolvedValue(row);
    sendMail.mockClear();
});

describe('BriefingService.email', () => {
    it('should send only the cards ticked, in the order the reader gave them, to the address of the account', async () => {
        // the third card of the briefing first, each once
        await BriefingService.email(4, '7', [3, 1, 3]);

        expect(ofUser).toHaveBeenCalledWith(4, 7);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe('reader@example.test');
        expect(mail.subject).toMatch(/^Your briefing · Football · 2 stories · /);
        expect(mail.text.indexOf('01. Third story')).toBeGreaterThan(0);
        expect(mail.text).toContain('02. First story');
        expect(mail.text).not.toContain('Second story');
        expect(mail.text).not.toContain('A VAR news');
    });

    it('should send to the address the reader wrote, saying who sends it, the answers to the reader', async () => {
        await BriefingService.email(4, 7, [2], ' friend@example.org ');

        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe('friend@example.org');
        expect(mail.replyTo).toBe('reader@example.test');
        expect(mail.subject).toMatch(/^lecteur shares 1 story of their NewsGenerator briefing · /);
        expect(mail.html).toContain('From the briefing of lecteur');
        expect(mail.html).toContain('Sent by lecteur from their briefing on NewsGenerator');
        expect(mail.html).not.toContain('Football');
    });

    it('should send as to the account when the address written is its own, whatever its case', async () => {
        await BriefingService.email(4, 7, [2], 'Reader@Example.test');

        const mail = sendMail.mock.calls[0][0];
        expect(mail.replyTo).toBeUndefined();
        expect(mail.subject).toMatch(/^Your briefing · Football · /);
    });

    it('should refuse an address that is not an email, before reading the briefing', async () => {
        for (const to of ['not an email', 'a@b', 42, 'a@b.c, d@e.f', 'a,b@example.org', 'Friend <f@example.org>']) {
            await expect(BriefingService.email(4, 7, [1], to)).rejects.toMatchObject({status: 400});
        }
        expect(ofUser).not.toHaveBeenCalled();
    });

    it('should refuse a list of cards that is missing, empty or not of cards, before reading the briefing', async () => {
        for (const storyIds of [undefined, [], [0], ['1'], 'all', null]) {
            await expect(BriefingService.email(4, 7, storyIds)).rejects.toMatchObject({status: 400});
        }
        expect(ofUser).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
    });

    it('should send nothing when none of the cards ticked is in the briefing, or the briefing is not ready', async () => {
        await expect(BriefingService.email(4, 7, [99])).rejects.toMatchObject({status: 404});
        ofUser.mockResolvedValue({...row, status: 'running'});
        await expect(BriefingService.email(4, 7, [1])).rejects.toMatchObject({status: 404});
        expect(sendMail).not.toHaveBeenCalled();
    });
});

// a PNG of 1 x 1 pixel
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('BriefingService.email with the pictures the reader chose', () => {
    beforeEach(() => ofUser.mockResolvedValue({...row, items: [
        card(1, 'First story', {thumbnail: 'https://93.184.215.14/first.jpg', thumbnailSource: 'media.fr'}),
        card(2, 'Second story', {thumbnail: 'https://93.184.215.14/card.jpg', thumbnailSource: 'media.fr', articles: [{source: 'kicker.de', url: 'https://kicker.de/1'}]}),
        card(3, 'Third story', {thumbnail: 'https://93.184.215.14/third.jpg', thumbnailSource: 'media.fr'}),
    ]}));

    it('should take a picture out, put another of the story credited to its medium, a file of the reader joined, and keep the others', async () => {
        await BriefingService.email(4, 7, [1, 2, 3], undefined, {
            1: null,
            2: {url: 'https://93.184.215.14/kicker.jpg'},
            3: {data: PNG},
            99: null,
        });

        const mail = sendMail.mock.calls[0][0];
        expect(mail.html).not.toContain('first.jpg');
        expect(mail.html).toContain('src="https://93.184.215.14/kicker.jpg"');
        expect(mail.html).toContain('Picture — kicker.de');
        expect(mail.html).toContain('src="cid:picture-3@newsgenerator"');
        expect(mail.html).toContain('Picture — added by you');
        expect(mail.attachments).toEqual([expect.objectContaining({cid: 'picture-3@newsgenerator', contentType: 'image/png', filename: 'picture-3.png'})]);
        expect(mail.attachments[0].content.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    });

    it('should credit a picture of the web to its address, and a file to the reader who sends it to another', async () => {
        await BriefingService.email(4, 7, [1, 3], 'friend@example.org', {1: {url: 'https://93.184.215.14/web.jpg'}, 3: {data: PNG}});

        const mail = sendMail.mock.calls[0][0];
        expect(mail.html).toContain('Picture — 93.184.215.14');
        expect(mail.html).toContain('Picture — added by lecteur');
    });

    it('should send nothing for a picture that is not an image of the web, nor an image file, or too heavy', async () => {
        const heavy = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64');
        for (const pictures of [
            {1: {url: 'javascript:alert(1)'}}, {1: {url: 'https://127.0.0.1/a.jpg'}}, {1: {url: 'ftp://93.184.215.14/a.jpg'}},
            {1: {data: Buffer.from('<svg onload="alert(1)"/>').toString('base64')}}, {1: {data: heavy}},
            {1: 'https://93.184.215.14/a.jpg'}, [null], 'none',
        ]) {
            await expect(BriefingService.email(4, 7, [1], undefined, pictures)).rejects.toMatchObject({status: 400});
        }
        expect(sendMail).not.toHaveBeenCalled();
    });

    it('should refuse files weighing more than 6 MB in all', async () => {
        const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(1900 * 1024)]).toString('base64');
        const files = Object.fromEntries([1, 2, 3].map(storyId => [storyId, {data: big}]));
        ofUser.mockResolvedValue({...row, items: [1, 2, 3, 4].map(storyId => card(storyId, `Story ${storyId}`))});
        await expect(BriefingService.email(4, 7, [1, 2, 3, 4], undefined, {...files, 4: {data: big}})).rejects.toMatchObject({status: 400});
        await BriefingService.email(4, 7, [1, 2, 3], undefined, files);
        expect(sendMail.mock.calls[0][0].attachments).toHaveLength(3);
    });
});

describe('BriefingService.pictures', () => {
    it('should offer the picture of the card first, then the ones of its articles, once each, credited to their medium', async () => {
        ofUser.mockResolvedValue({...row, items: [card(2, 'Second story', {
            thumbnail: 'https://93.184.215.14/card.jpg', thumbnailSource: 'media.fr', articles: [{source: 'kicker.de', url: 'https://kicker.de/1'}],
        })]});

        expect(await BriefingService.pictures(4, 7, '2')).toEqual([
            {url: 'https://93.184.215.14/card.jpg', source: 'media.fr'},
            {url: 'https://93.184.215.14/kicker.jpg', source: 'kicker.de'},
        ]);
        expect(articlePictures).toHaveBeenCalledWith(2, ['https://media.fr/2', 'https://kicker.de/1']);
        await expect(BriefingService.pictures(4, 7, '9')).rejects.toMatchObject({status: 404});
    });
});

describe('briefingMail', () => {
    const briefing = {hours: 24, finishedAt: '2026-10-08T06:01:00.000Z', items: [
        card(1, 'Gipfel gegen Infantino', {
            titleTranslation: 'Sommet contre Infantino', language: 'de', translation: 'Le premier passage.\n\nLe second.',
            why: 'Du football, que vous suivez.', thumbnail: 'https://cdn.example/a.jpg', thumbnailSource: 'sport1.de', sourcing: 'named',
            contested: [{by: 'Infantino', sentence: 'Das stimmt nicht.', translation: 'Ce n’est pas vrai.', source: 'bild.de', url: 'https://bild.de/a'}],
            angles: [{title: 'Le Nigeria porte plainte', url: 'https://rfi.fr/n', source: 'rfi.fr', language: 'fr', media: 3}],
            articles: [{source: 'media.fr', url: 'https://media.fr/1'}, {source: 'kicker.de', url: 'https://kicker.de/1', language: 'de'}],
        }),
        card(2, '<script>alert(1)</script>', {thumbnail: 'javascript:alert(1)', hedged: 'selon nos informations'}),
    ]};

    it('should lay out a card as the page: number, translated title, why, picture, passages, denial, angles, links, notes', () => {
        const {html} = briefingMail(briefing, 'Football');

        for (const part of ['>01<', 'Sommet contre Infantino', 'Translated from German', '“Gipfel gegen Infantino”', 'Du football, que vous suivez.',
            'src="https://cdn.example/a.jpg"', 'Picture — sport1.de', 'In the article&#39;s words, translated', 'second.', '[…]',
            'Contested', 'Infantino denies:', 'Machine translation: “Ce n’est pas vrai.”', 'Same affair, other angles', 'Le Nigeria porte plainte',
            'told by 3 media', 'Read the article at media.fr', 'Also covered by', 'kicker.de', 'Who tells it',
            'Told by 3 media, 2 texts written independently of 3 read', 'named sources', 'Not confirmed']) {
            expect(html).toContain(part);
        }
    });

    it('should leave out the why, written to the reader, of an e-mail sent by them to another', () => {
        expect(briefingMail(briefing, 'Football').html).toContain('Du football, que vous suivez.');
        const {html, text} = briefingMail(briefing, 'Football', {sender: 'lecteur'});
        expect(html).not.toContain('que vous suivez');
        expect(text).not.toContain('que vous suivez');
    });

    it('should escape the texts and never link nor show an address that is not of the web', () => {
        const {html} = briefingMail(briefing, null);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('javascript:');
    });
});
