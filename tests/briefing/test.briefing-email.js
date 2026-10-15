//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.briefing-email.js
//  Description: The cards of a briefing the reader ticked sent by e-mail, to the address of the account
//               or to the one they write, in the order they gave, laid out as the page shows them
//

import {Buffer} from 'node:buffer';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const sendMail = jest.fn(async () => {});
const articlePictures = jest.fn(async () => [
    {link: 'https://kicker.de/1', thumbnail: 'https://93.184.215.14/kicker.jpg'},
    {link: 'https://media.fr/2', thumbnail: 'https://93.184.215.14/card.jpg'},
    {link: 'https://other.example/3', thumbnail: 'javascript:alert(1)'},
]);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const markSent = jest.fn(async () => 1);
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, articlePictures, markSent}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test', username: 'lecteur'}))}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async () => ({name: 'Football'}))}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({sendMail, mailEnabled: () => true}));
const copies = {save: jest.fn(async () => 11), byToken: jest.fn(async () => null), remove: jest.fn(async () => 1)};
jest.unstable_mockModule('../../models/sent-mail-model.js', () => ({SentMailModel: copies}));
const {BriefingService, withOwnTitles, withoutTakenOut} = await import('../../services/briefing-service.js');
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
    markSent.mockReset().mockResolvedValue(1);
});

describe('BriefingService.email and the cards read', () => {
    it('should mark the cards sent as read, only once the e-mail is gone', async () => {
        await BriefingService.email(4, '7', [3, 1, 3]);
        expect(markSent).toHaveBeenCalledWith(4, 7, [3, 1]);

        markSent.mockClear();
        sendMail.mockRejectedValueOnce(Object.assign(new Error('The e-mail could not be sent, try again later.'), {status: 502}));
        await expect(BriefingService.email(4, 7, [2])).rejects.toMatchObject({status: 502});
        expect(markSent).not.toHaveBeenCalled();
    });

    it('should not fail an e-mail sent when the cards could not be marked', async () => {
        markSent.mockRejectedValueOnce(new Error('database down'));
        await expect(BriefingService.email(4, 7, [1])).resolves.toBeUndefined();
        expect(sendMail).toHaveBeenCalledTimes(1);
    });
});

describe('BriefingService.email', () => {
    it('should send only the cards ticked, in the order the reader gave them, to the address of the account', async () => {
        // the third card of the briefing first, each once
        await BriefingService.email(4, '7', [3, 1, 3]);

        expect(ofUser).toHaveBeenCalledWith(4, 7);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe('reader@example.test');
        // the name of the profile, the day without its hour
        expect(mail.subject).toBe('Football’s Briefing · 2 stories · 8 October 2026');
        expect(mail.html).toContain('>Football’s Briefing · 8 October 2026<');
        // the title alone, no count of the stories under it
        expect(mail.html).not.toContain('shared');
        expect(mail.text.indexOf('01. Third story')).toBeGreaterThan(0);
        expect(mail.text).toContain('02. First story');
        expect(mail.text).not.toContain('Second story');
        expect(mail.text).not.toContain('A VAR news');
    });

    it('should send a card without the other angles taken out, and nothing when they are not named by their places', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {angles: [
            {title: 'Kept angle', url: 'https://rfi.fr/1', source: 'rfi.fr'}, {title: 'Taken angle', url: 'https://rfi.fr/2', source: 'rfi.fr'}]})]});
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, {1: {angles: [1]}});
        expect(sendMail.mock.calls[0][0].html).toContain('Kept angle');
        expect(sendMail.mock.calls[0][0].html).not.toContain('Taken angle');

        await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, {1: {angles: 'all'}})).rejects.toMatchObject({status: 400});
        expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('should send to the address the reader wrote, saying who sends it, the answers to the reader', async () => {
        await BriefingService.email(4, 7, [2], ' friend@example.org ');

        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe('friend@example.org');
        expect(mail.replyTo).toBe('reader@example.test');
        expect(mail.subject).toBe('Football’s Briefing · 1 story · 8 October 2026');
        expect(mail.html).toContain('>Football’s Briefing · 8 October 2026<');
        expect(mail.html).not.toContain('08:01');
        expect(mail.html).not.toContain('lecteur');
        expect(mail.text).not.toContain('lecteur');
        // nothing at the end of it: answered, it goes to the reader all the same (replyTo)
        expect(mail.html).not.toContain('Sent by');
        expect(mail.html).not.toContain('The key points are');
    });

    it('should send as to the account when the address written is its own, whatever its case', async () => {
        await BriefingService.email(4, 7, [2], 'Reader@Example.test');

        const mail = sendMail.mock.calls[0][0];
        expect(mail.replyTo).toBeUndefined();
        expect(mail.subject).toBe('Football’s Briefing · 1 story · 8 October 2026');
    });

    it('should send the cards in the way the reader chose, and refuse a way that does not exist, before reading the briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {points: 'The point.', digest: 'The digest.'})]});
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points');
        expect(sendMail.mock.calls[0][0].text).toContain('• The point.');

        ofUser.mockClear();
        await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'tweets')).rejects.toMatchObject({status: 400});
        expect(ofUser).not.toHaveBeenCalled();
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

describe('BriefingService.email without a copy kept', () => {
    beforeEach(() => Object.values(copies).forEach(fn => fn.mockClear()));

    it('should keep no copy and give no link to one (the user, 13.10.2026)', async () => {
        await BriefingService.email(4, 7, [1]);
        const mail = sendMail.mock.calls[0][0];
        expect(copies.save).not.toHaveBeenCalled();
        for (const gone of ['View the original', '/api/mails/', 'as it was sent']) {
            expect(mail.html).not.toContain(gone);
            expect(mail.text).not.toContain(gone);
        }
    });

    it('should read a copy of an e-mail sent before by its token only, never asking the database for a token of another form', async () => {
        copies.byToken.mockResolvedValueOnce({subject: 'S', html: '<p>sent</p>'});
        expect(await BriefingService.original('abcdefghijklmnopqrstuvwx')).toEqual({subject: 'S', html: '<p>sent</p>'});
        await expect(BriefingService.original('abcdefghijklmnopqrstuvwy')).rejects.toMatchObject({status: 404});
        for (const token of ['short', "' OR 1=1 --aaaaaaaaaaaaa", undefined, 'abcdefghijklmnopqrstuvwx/']) {
            await expect(BriefingService.original(token)).rejects.toMatchObject({status: 404});
        }
        expect(copies.byToken).toHaveBeenCalledTimes(2);
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
        const {html} = briefingMail(briefing);

        for (const part of ['>01<', 'Sommet contre Infantino', 'Translated from German', '“Gipfel gegen Infantino”', 'Du football, que vous suivez.',
            'src="https://cdn.example/a.jpg"', 'Picture — sport1.de', 'Key passages', 'second.', '[…]',
            'Contested', 'Infantino denies:', 'Machine translation: “Ce n’est pas vrai.”', 'Same affair, other angles', 'Le Nigeria porte plainte',
            'told by 3 media', 'Read the article at media.fr', 'Also covered by', 'kicker.de', 'Not confirmed']) {
            expect(html).toContain(part);
        }
        // who tells it: its sources say it already (the user, 13.10.2026)
        expect(html).not.toContain('Who tells it');
        expect(html).not.toContain('written independently');
    });

    it('should keep each medium and its language on one line, the media following each other with a comma', () => {
        const {html} = briefingMail({...briefing, items: [card(1, 'Story', {articles: [
            {source: 'media.fr', url: 'https://media.fr/1', language: 'fr'},
            {source: 'kicker.de', url: 'https://kicker.de/1', language: 'de'},
            {source: 'marca.com', url: 'https://marca.com/1', language: 'es'},
        ]})]});
        // a mail app put each inline-block mark on a line of its own (14.10.2026)
        expect(html).not.toContain('inline-block');
        expect(html).toMatch(/<span style="white-space:nowrap"><a href="https:\/\/kicker\.de\/1"[^>]*>kicker\.de<\/a> <span class="ng-box"[^>]*>de<\/span><\/span>, <span style="white-space:nowrap"><a href="https:\/\/marca\.com\/1"/);
    });

    it('should leave out the notes that tell nothing: the AI choosing the passages, one medium, the sources named', () => {
        const {html} = briefingMail({...briefing, items: [card(1, 'Alone', {corroboration: {media: 1, read: 1, independent: 1, agencies: []}, sourcing: 'named'})]});
        for (const gone of ['Sentences chosen by the AI', 'In the article', 'Only one medium', 'Who tells it', 'Its sources', 'named sources', 'Written Thursday']) {
            expect(html).not.toContain(gone);
        }
        // no profile named: the title alone
        expect(html).toContain('>Briefing · 8 October 2026<');
        expect(html).not.toMatch(/Enzo|enzo/);
        expect(html).not.toContain('story shared');
        expect(html).not.toMatch(/>NewsGenerator</);
    });

    it('should show the title the reader wrote instead of the one of the card, without its original', () => {
        const items = withOwnTitles(briefing.items, {1: '  Infantino  contesté ', 2: ''});
        const {html, text} = briefingMail({...briefing, items});
        expect(html).toContain('Infantino contesté');
        expect(html).not.toContain('Sommet contre Infantino');
        expect(html).not.toContain('“Gipfel gegen Infantino”');
        expect(text).toContain('01. Infantino contesté');
        expect(html).toContain('&lt;script&gt;');
        expect(() => withOwnTitles(briefing.items, {1: 'x'.repeat(301)})).toThrow(/300/);
        expect(() => withOwnTitles(briefing.items, [1])).toThrow();
    });

    it('should leave out the denials and the other angles the reader took out, and their title once none is left', () => {
        const two = card(1, 'Two angles', {
            contested: briefing.items[0].contested,
            angles: [{title: 'First angle', url: 'https://rfi.fr/1', source: 'rfi.fr'}, {title: 'Second angle', url: 'https://rfi.fr/2', source: 'rfi.fr'}],
        });
        const one = withoutTakenOut([two], {1: {angles: [0]}});
        let {html, text} = briefingMail({...briefing, items: one});
        expect(html).not.toContain('First angle');
        expect(text).not.toContain('First angle');
        expect(html).toContain('Second angle');
        expect(html).toContain('Same affair, other angles');
        expect(html).toContain('Contested');

        ({html, text} = briefingMail({...briefing, items: withoutTakenOut([two], {1: {angles: [0, 1], contested: [0]}})}));
        for (const gone of ['Same affair, other angles', 'First angle', 'Second angle', 'Contested', 'denies']) {
            expect(html).not.toContain(gone);
            expect(text).not.toContain(gone);
        }
        // a card not named keeps all of it
        expect(withoutTakenOut([two], {2: {angles: [0]}})[0].angles).toHaveLength(2);
        for (const wrong of [[0], {1: [0]}, {1: {angles: [-1]}}, {1: {angles: ['0']}}, {1: {passages: [0]}}]) {
            expect(() => withoutTakenOut([two], wrong)).toThrow(/removed/);
        }
    });

    it('should show the official sources of a card in its notes, and leave out the ones taken out', () => {
        const official = card(1, 'Official', {official: [
            {party: 'UEFA', title: 'Čeferin seeks final term', url: 'https://www.uefa.com/news/1', channel: 'site', publishedAt: '2026-10-08T09:00:00.000Z'},
            {party: '<FIGC>', title: 'Malagò commissario', url: 'javascript:alert(1)', channel: 'site', publishedAt: null},
        ]});
        let {html, text} = briefingMail({...briefing, items: [official]});
        expect(html).toContain('Official source');
        expect(html).toContain('<b>UEFA</b> said it: <a href="https://www.uefa.com/news/1"');
        // a post without a web address is no link
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('&lt;FIGC&gt;');
        expect(text).toContain('Official source — UEFA said it: Čeferin seeks final term https://www.uefa.com/news/1');

        ({html, text} = briefingMail({...briefing, items: withoutTakenOut([official], {1: {official: [0, 1]}})}));
        expect(html).not.toContain('Official source');
        expect(text).not.toContain('Official source');
    });

    it('should quote a statement an article reports, translated, with the medium reporting it', () => {
        const reported = card(1, 'Reported', {official: [{party: 'FPF', title: 'A FPF publicou um comunicado.', translation: 'The FPF published a statement.',
            language: 'pt', url: 'https://www.abola.pt/1', source: 'abola.pt', channel: 'reported', publishedAt: null}]});
        const {html, text} = briefingMail({...briefing, items: [reported]});
        expect(html).toContain('<b>FPF</b> said it, reported by <a href="https://www.abola.pt/1"');
        expect(html).toContain('“The FPF published a statement.” (machine translation)');
        expect(text).toContain('Official source — FPF said it, reported by abola.pt: "The FPF published a statement." https://www.abola.pt/1');
    });

    it('should leave out the why, written to the reader, of an e-mail sent by them to another', () => {
        expect(briefingMail(briefing).html).toContain('Du football, que vous suivez.');
        const {html, text} = briefingMail(briefing, {sender: 'lecteur'});
        expect(html).not.toContain('que vous suivez');
        expect(text).not.toContain('que vous suivez');
    });

    it('should show the sentences in the way the reader chose: bullet points, a summary or the key passages', () => {
        const ways = card(1, 'Ways', {summary: 'Un.\n\nDeux.\n\nTrois.', points: 'Deux.\n\nUn.', digest: 'Un.\n\nTrois.'});

        let {html, text} = briefingMail({...briefing, items: [ways]}, {format: 'points'});
        expect(html).toContain('Key points');
        expect(html).toMatch(/<ul[^>]*><li[^>]*>Deux\.<\/li><li[^>]*>Un\.<\/li><\/ul>/);
        expect(text).toContain('• Deux.\n• Un.');

        ({html, text} = briefingMail({...briefing, items: [ways]}, {format: 'digest'}));
        expect(html).toContain('Summary');
        expect(html).toContain('n. […] Trois.');
        expect(text).toContain('Un. […] Trois.');
        expect(html).not.toContain('Deux.');

        ({html, text} = briefingMail({...briefing, items: [ways]}));
        expect(html).toContain('Key passages');
        expect(text).toContain('Un.\n[…]\nDeux.\n[…]\nTrois.');
    });

    it('should send the translated sentences of a way, and the key passages of a card made before the other ways', () => {
        const translated = card(1, 'Gipfel', {language: 'de', points: 'Erster.', pointsTranslation: 'Premier.', translation: 'Passage.'});
        const {html, text} = briefingMail({...briefing, items: [translated, card(2, 'Older')]}, {format: 'points'});
        expect(html).toContain('Translated from German');
        expect(text).toContain('• Premier.');
        expect(text).not.toContain('Erster.');
        // the older card: its key passages, as written
        expect(text).toContain('Passage of Older.\n[…]\nAnother passage.');
    });

    it('should escape the texts and never link nor show an address that is not of the web', () => {
        const {html} = briefingMail(briefing);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('javascript:');
    });
});

describe('BriefingService.email with the AI analysis of the cards', () => {
    const analysis = {status: 'ready', model: 'deepseek-v4-pro:0813', picked: [{storyId: 1, reason: 'a vote to come'}], cards: {1: {
        why: ['UEFA says the plan <lacks> support.', 'The vote is on 18 March.'],
        next: [{if: 'the Council refuses', then: 'the plan is dropped'}],
        timeline: [{date: '2026-10-12', title: 'Wenger may run', medium: 'eurosport.fr', url: 'https://eurosport.fr/1', titleTranslation: null}],
    }}};
    const sent = () => sendMail.mock.calls.at(-1)[0];

    it('should send the analysis of a card under its sentences, without saying the AI wrote it (the user, 15.10.2026)', async () => {
        ofUser.mockResolvedValue({...row, analysis});
        await BriefingService.email(4, 7, [1, 2]);
        const {html, text} = sent();
        expect(html).toContain('Why it matters');
        expect(html).toContain('UEFA says the plan &lt;lacks&gt; support.');
        expect(html).toContain('<b>If</b> the Council refuses, <b>then</b> the plan is dropped');
        expect(html).toContain('The story so far');
        expect(html).toContain('href="https://eurosport.fr/1"');
        expect(text).toContain('• If the Council refuses, then the plan is dropped');
        for (const mention of ['AI analysis', 'Written by the AI', 'deepseek']) {
            expect(html).not.toContain(mention);
            expect(text).not.toContain(mention);
        }
        // the second card has none
        expect(html.split('Why it matters').length).toBe(2);
    });

    it('should leave out the lines the reader unticked, and the whole analysis once none is left', async () => {
        ofUser.mockResolvedValue({...row, analysis});
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, {1: {why: [0], timeline: [0]}});
        let {html} = sent();
        expect(html).not.toContain('lacks');
        expect(html).toContain('The vote is on 18 March.');
        expect(html).not.toContain('The story so far');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, {1: {why: [0, 1], next: [0], timeline: [0]}});
        ({html} = sent());
        expect(html).not.toContain('What could come next');
        expect(html).not.toContain('Why it matters');
    });

    it('should send no analysis while it is written, nor one of another shape', async () => {
        ofUser.mockResolvedValue({...row, analysis: {...analysis, status: 'running'}});
        await BriefingService.email(4, 7, [1]);
        expect(sent().html).not.toContain('Why it matters');

        ofUser.mockResolvedValue({...row, analysis: {status: 'ready', changed: [{text: 'x', storyIds: [1]}], risks: []}});
        await BriefingService.email(4, 7, [1]);
        expect(sent().html).not.toContain('Why it matters');
    });
});

describe('BriefingService.email with the AI version of some cards', () => {
    const ai = {points: ['The SBB strike on Monday.', '1,200 trains will not run.'], summary: 'The SBB strike on Monday: 1,200 trains will not run.', model: 'deepseek-v4-pro:0813'};
    const sent = () => sendMail.mock.calls.at(-1)[0];
    beforeEach(() => ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {points: 'Published point.', digest: 'Published digest.', ai}),
        card(2, 'Second story', {points: 'Other published point.', digest: 'Other digest.'})]}));

    it('should send the cards asked in their AI version, the others as published, without saying the AI wrote it', async () => {
        await BriefingService.email(4, 7, [1, 2], undefined, undefined, undefined, undefined, 'points', [1, 2]);
        const {html, text} = sent();
        expect(html).toContain('The SBB strike on Monday.');
        expect(html).not.toContain('Published point.');
        // the second card has no AI version: as published
        expect(html).toContain('Other published point.');
        expect(text).toContain('• 1,200 trains will not run.');
        for (const mention of ['AI', 'deepseek']) expect(text).not.toMatch(new RegExp(`\b${mention}\b`));
    });

    it('should send the AI summary in the summary way, and the key passages as published whatever is asked', async () => {
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'digest', [1]);
        // its first letter is the drop cap of the e-mail
        expect(sent().html).toContain('he SBB strike on Monday: 1,200 trains will not run.');
        expect(sent().html).not.toContain('Published digest.');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [1]);
        expect(sent().html).toContain('assage of First story.');
        expect(sent().html).not.toContain('The SBB strike');
    });

    it('should send the cards as published without a list, and refuse one that is not of storyIds', async () => {
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points');
        expect(sent().html).toContain('Published point.');
        await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points', ['1'])).rejects.toMatchObject({status: 400});
    });
});
