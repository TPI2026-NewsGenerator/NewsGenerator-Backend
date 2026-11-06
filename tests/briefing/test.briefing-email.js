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
// the affair of a card for the e-mail: built by the AI, and the service of the affairs reads the briefing service (see withAffairs)
const forMail = jest.fn(async () => null);
jest.unstable_mockModule('../../services/affair-service.js', () => ({AffairService: {forMail}}));
const {BriefingService, previewHtml, withAffairs, withBlocks, withOwnCountries, withOwnTexts, withOwnTitles, withoutTakenOut} = await import('../../services/briefing-service.js');
const {briefingMail, LABELS} = await import('../../services/utils/briefing-mail.js');

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
    forMail.mockReset().mockResolvedValue(null);
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
        expect(mail.subject).toBe('Football’s Briefing · 8 October 2026 · 2 stories');
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
        expect(mail.subject).toBe('Football’s Briefing · 8 October 2026 · 1 story');
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
        expect(mail.subject).toBe('Football’s Briefing · 8 October 2026 · 1 story');
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
        expect(mail.html).toContain('Picture — kicker.&#8203;de');
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

        for (const part of ['>01<', 'Sommet contre Infantino', 'Du football, que vous suivez.',
            'src="https://cdn.example/a.jpg"', 'Picture — sport1.&#8203;de', 'Key passages', 'second.', '[…]',
            'Contested', 'Infantino denies:', 'Infantino denies:</b> “Ce n’est pas vrai.”', 'Same affair, other angles', 'Le Nigeria porte plainte',
            'told by 3 media', 'Read the article at media.fr', 'Also covered by', 'kicker.de', 'Not confirmed']) {
            expect(html).toContain(part);
        }
        // who tells it: its sources say it already (the user, 13.10.2026)
        expect(html).not.toContain('Who tells it');
        expect(html).not.toContain('written independently');
        // nothing says what is translated, the original title neither (the user, 16.10.2026)
        expect(html).not.toMatch(/translat/i);
        expect(html).not.toContain('Gipfel gegen Infantino');
    });

    it('should say the countries of a card above its title, in the reader language, never its topic', () => {
        const items = [{...briefing.items[0], countries: ['CH', 'DE']}, {...briefing.items[1], countries: []}];
        const {html, text} = briefingMail({...briefing, items}, {language: 'fr', labels: LABELS});

        expect(html).toContain('Suisse · Allemagne');
        expect(text).toContain('(Suisse, Allemagne)');
        // the cards of one reader are of one topic, "sport" card after card (the user, 18.10.2026)
        expect(html).not.toMatch(/>sport</i);
    });

    it('should keep each medium and its language on one line, the media following each other with a comma', () => {
        const {html} = briefingMail({...briefing, items: [card(1, 'Story', {articles: [
            {source: 'media.fr', url: 'https://media.fr/1', language: 'fr'},
            {source: 'kicker.de', url: 'https://kicker.de/1', language: 'de'},
            {source: 'marca.com', url: 'https://marca.com/1', language: 'es'},
        ]})]});
        // a mail app put each inline-block mark on a line of its own (14.10.2026)
        expect(html).not.toContain('inline-block');
        expect(html).toMatch(/<span style="white-space:nowrap"><a href="https:\/\/kicker\.de\/1"[^>]*>kicker\.de<\/a> <span title="[^"]*" style="[^"]*">de<\/span><\/span>, <span style="white-space:nowrap"><a href="https:\/\/marca\.com\/1"/);
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

    // "Who it is about": each name can be taken out, as the lines of the analysis and the angles are (the user, 05.11.2026)
    it('should leave out the names of who it is about the reader took out, and the row once none is left', () => {
        const named = card(1, 'Three names', {names: [{name: 'FIFA'}, {name: 'UEFA'}, {name: 'Infantino'}]});
        const blocks = {1: {names: true}};
        let {html, text} = briefingMail({...briefing, items: withBlocks(withoutTakenOut([named], {1: {names: [1]}}), blocks)});
        expect(html).toContain('FIFA');
        expect(html).toContain('Infantino');
        expect(html).not.toContain('UEFA');
        expect(text).not.toContain('UEFA');
        expect(html).toContain('Who it is about');

        ({html, text} = briefingMail({...briefing, items: withBlocks(withoutTakenOut([named], {1: {names: [0, 1, 2]}}), blocks)}));
        for (const gone of ['Who it is about', 'FIFA', 'UEFA', 'Infantino']) {
            expect(html).not.toContain(gone);
            expect(text).not.toContain(gone);
        }
        // a card not named keeps all of them, a place that is not a number is refused
        expect(withoutTakenOut([named], {2: {names: [0]}})[0].names).toHaveLength(3);
        expect(() => withoutTakenOut([named], {1: {names: ['0']}})).toThrow(/names: \[index\]/);
    });

    it("should write all of it in the reader's language: its words, its dates, the names of languages, what is translated", () => {
        const labels = {...LABELS, contested: 'Contesté', denies: '{by} dément :', 'topic.sport': 'sport', keyPassages: 'Passages clés',
            readAt: 'Lire l’article sur {source}', toldBy: 'raconté par {count} médias', notConfirmed: 'Non confirmé',
            unconfirmed: 'non confirmé : « {words} »', writtenIn: 'Écrit en {language}', saidIt: '{party} l’a dit :', picture: 'Image', briefingOf: 'Le briefing de {name}'};
        const items = [{...briefing.items[0], official: [{party: 'DFB', title: 'DFB-Präsidium entscheidet', translation: 'Le présidium de la DFB décide',
            url: 'https://www.dfb.de/1', channel: 'site', publishedAt: null}]}, {...briefing.items[1], hedgedTranslation: 'selon nos sources'}];
        const {html, subject} = briefingMail({...briefing, items}, {profile: 'Roberto', language: 'fr', labels});

        expect(subject).toBe('Le briefing de Roberto · 8 octobre 2026 · 2 stories');
        for (const part of ['Contesté', '<b>Infantino dément :</b> “Ce n’est pas vrai.”', 'Passages clés', 'Lire l’article sur media.fr',
            'raconté par 3 médias', 'Image — sport1.&#8203;de', 'title="Écrit en allemand"', 'Non confirmé', 'non confirmé : « selon nos sources »',
            '<b>DFB</b> l’a dit : <a href="https://www.dfb.de/1"', '>Le présidium de la DFB décide</a>']) {
            expect(html).toContain(part);
        }
        for (const english of ['Contested', 'denies', 'Read the article', 'Picture —', 'October', 'DFB-Präsidium']) expect(html).not.toContain(english);
        // nothing says what is translated, in the reader's language neither (the user, 16.10.2026)
        expect(html).not.toMatch(/tradu|translat/i);
    });

    it('should credit a file the reader joined to who added it, in their language', () => {
        const added = {...briefing.items[0], thumbnail: 'cid:picture-1@newsgenerator', thumbnailSource: null};
        expect(briefingMail({...briefing, items: [{...added, addedBy: ''}]}).html).toContain('Picture — added by you');
        expect(briefingMail({...briefing, items: [{...added, addedBy: 'lecteur'}]}, {language: 'fr', labels: {...LABELS, picture: 'Image', addedBy: 'ajoutée par {name}'}}).html)
            .toContain('Image — ajoutée par lecteur');
    });

    it('should show the official sources of a card in its notes, and leave out the ones taken out', () => {
        const official = card(1, 'Official', {official: [
            {party: 'UEFA', title: 'Čeferin seeks final term', url: 'https://www.uefa.com/news/1', channel: 'site', publishedAt: '2026-10-08T09:00:00.000Z'},
            {party: '<FIGC>', title: 'Malagò commissario', url: 'javascript:alert(1)', channel: 'site', publishedAt: null},
        ]});
        let {html, text} = briefingMail({...briefing, items: [official]});
        expect(html).toContain('>Official sources<');
        // in green, as on the page (the user, 5.11.2026), the denials in orange
        expect(html).toMatch(/color:#248A3D">Official sources</);
        expect(briefingMail({...briefing, items: [official]}, {theme: 'dark'}).html).toMatch(/color:#30D158">Official sources</);
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
        expect(html).toContain('“The FPF published a statement.”</p>');
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
        expect(html).toContain('Premier.');
        expect(text).toContain('• Premier.');
        expect(text).not.toContain('Erster.');
        // the older card: its key passages, as written
        expect(text).toContain('Passage of Older.\n[…]\nAnother passage.');
    });

    it('should show in italics the sentence the translation left in its own language, and mark nothing in the text', () => {
        const left = '(Er wurde mit 10.000 Euro bestraft.)';
        const translated = card(1, 'Gipfel', {language: 'de', translation: `Premier <passage>. ${left}\n\n${left}`});
        const {html, text} = briefingMail({...briefing, items: [translated]});
        expect(html).toContain('remier &lt;passage&gt;. <i>(Er wurde mit 10.000 Euro bestraft.)</i>');
        // the second passage is only the sentence: in italics all of it
        expect(html).toContain('<i>(Er wurde mit 10.000 Euro bestraft.)</i></p>');
        expect(html).not.toMatch(/[]/);
        expect(text).toContain('Premier <passage>. (Er wurde mit 10.000 Euro bestraft.)\n[…]\n(Er wurde mit 10.000 Euro bestraft.)');
        expect(text).not.toMatch(/[]/);
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

describe('BriefingService.email with the sentences the reader wrote', () => {
    const ai = {points: ['The SBB strike on Monday.'], summary: 'The SBB strike on Monday.', model: 'deepseek-v4-pro:0813'};
    const sent = () => sendMail.mock.calls.at(-1)[0];
    beforeEach(() => ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {points: 'Published point.', digest: 'Published digest.', ai}),
        card(2, 'Second story', {points: 'Other published point.', digest: 'Other digest.'})]}));

    it('should send the points, the summary or the key passages the reader wrote instead of the ones of the card, the others as published', async () => {
        await BriefingService.email(4, 7, [1, 2], undefined, undefined, undefined, undefined, 'points', [], {1: ['My first point.', '  My   second point. ']});
        expect(sent().html).toContain('My first point.');
        expect(sent().text).toContain('• My second point.');
        expect(sent().html).not.toContain('Published point.');
        expect(sent().html).toContain('Other published point.');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'digest', [], {1: ['My summary.', 'Its end.']});
        expect(sent().text).toContain('My summary. […] Its end.');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], {1: ['My passage.']});
        expect(sent().html).toContain('y passage.');
        expect(sent().html).not.toContain('assage of First story.');
    });

    it('should send what the reader wrote rather than the AI version, and the ones of the card for a text left empty', async () => {
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points', [1], {1: ['Written by the reader.']});
        expect(sent().html).toContain('Written by the reader.');
        expect(sent().html).not.toContain('The SBB strike');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points', [], {1: ['', '   ']});
        expect(sent().html).toContain('Published point.');
    });

    it('should refuse texts that are not lists of paragraphs, or too long, before sending', async () => {
        sendMail.mockClear();
        for (const texts of [['a'], {1: 'a point'}, {1: [3]}, {1: Array(21).fill('a')}, {1: ['a'.repeat(2001)]}]) {
            await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'points', [], texts)).rejects.toMatchObject({status: 400});
        }
        expect(sendMail).not.toHaveBeenCalled();
        expect(withOwnTexts([{storyId: 1}], undefined)).toEqual([{storyId: 1}]);
    });
});

describe('BriefingService.email with the countries the reader chose', () => {
    const sent = () => sendMail.mock.calls.at(-1)[0];
    beforeEach(() => ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {countries: ['FR', 'CH']}), card(2, 'Second story', {countries: ['ES']})]}));

    it('should send the countries the reader chose instead of the ones found, the other cards as found (the user, 2.11.2026)', async () => {
        await BriefingService.email(4, 7, [1, 2], undefined, undefined, undefined, undefined, 'passages', [], undefined, {1: ['DE', 'IT']});
        expect(sent().html).toContain('Germany · Italy');
        expect(sent().html).not.toContain('France');
        expect(sent().html).toContain('Spain');
        expect(sent().text).toContain('01. First story (Germany, Italy)');
        expect(sent().text).toContain('02. Second story (Spain)');
    });

    // the country of a card is shown even when its title names it (the user, 06.11.2026: "Aruba" and "Cameroun" were found and not drawn)
    it('should show the countries of a card as found, even when its title names them', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'Zambia sacks its coach', {countries: ['ZM']}), card(2, 'Second story', {countries: ['ES']})]});
        await BriefingService.email(4, 7, [1, 2]);
        expect(sent().html).toContain('>Zambia<');
        expect(sent().html).toContain('Spain');
        expect(sent().text).toContain('01. Zambia sacks its coach (Zambia)');
    });

    it('should show a country the reader chose even when the title names it, and none when the list is empty', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'Zambia sacks its coach', {countries: ['ZM']}), card(2, 'Second story', {countries: ['ES']})]});
        await BriefingService.email(4, 7, [1, 2], undefined, undefined, undefined, undefined, 'passages', [], undefined, {1: ['ZM'], 2: []});
        expect(sent().html).toContain('>Zambia<');
        expect(sent().text).toContain('01. Zambia sacks its coach (Zambia)');
        expect(sent().text).toContain('02. Second story\n');
        expect(sent().html).not.toContain('Spain');
    });

    it('should refuse what is not a country code, or more than 10 countries, before sending', async () => {
        sendMail.mockClear();
        for (const countries of [['FR'], {1: 'FR'}, {1: ['france']}, {1: ['EU']}, {1: ['ZZ']}, {1: [3]}, {1: ['FR', 'CH', 'DE', 'IT', 'ES', 'PT', 'AT', 'BE', 'NL', 'PL', 'SE']}]) {
            await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, countries)).rejects.toMatchObject({status: 400});
        }
        expect(sendMail).not.toHaveBeenCalled();
        expect(withOwnCountries([{storyId: 1}], undefined)).toEqual([{storyId: 1}]);
        expect(withOwnCountries([{storyId: 1}], {1: ['FR', 'FR']})).toEqual([{storyId: 1, ownCountries: ['FR']}]);
    });
});

describe('briefingMail, the name of the profile and the design of the page', () => {
    const briefing = {hours: 24, finishedAt: '2026-11-02T06:01:00.000Z', items: [card(1, 'First story', {why: 'Why.', thumbnail: 'https://cdn.example/a.jpg'})]};

    it('should write only the apostrophe after a name that ends in s: "Chris’ Briefing" (the user, 2.11.2026)', () => {
        for (const [name, written] of [['Chris', 'Chris’ Briefing'], ['James', 'James’ Briefing'], ['CHRIS', 'CHRIS’ Briefing'], ['Enzo', 'Enzo’s Briefing'], ['Roberto', 'Roberto’s Briefing']]) {
            const mail = briefingMail(briefing, {profile: name.trim()});
            expect(mail.subject).toBe(`${written} · 2 November 2026 · 1 story`);
            expect(mail.html).toContain(`>${written} · 2 November 2026<`);
            expect(mail.text).toContain(`${written} · 2 November 2026`);
        }
        expect(briefingMail(briefing).subject).toBe('Briefing · 2 November 2026 · 1 story');
    });

    it('should keep the word of another language for a name that ends in s, whatever its letters', () => {
        const french = {...LABELS, briefingOf: 'Le briefing de {name}'};
        expect(briefingMail(briefing, {profile: 'Chris', language: 'fr', labels: french}).subject).toBe('Le briefing de Chris · 2 novembre 2026 · 1 story');
    });

    const full = {...briefing, items: [{...briefing.items[0], contested: [{by: 'Infantino', sentence: 'No.', source: 'bild.de', url: 'https://bild.de/a'}],
        official: [{party: 'UEFA', title: 'A post', url: 'https://uefa.com/a', channel: 'site'}]}]};
    const LIGHT_COLOURS = ['#FFFFFF', '#F5F5F7', '#1D1D1F', '#6E6E73', '#D2D2D7', '#0066CC', '#BF4800', '#248A3D'];
    const DARK_COLOURS = ['#1C1C1E', '#2C2C2E', '#F5F5F7', '#98989D', '#3A3A3C', '#2997FF', '#FF9F0A', '#30D158'];

    it('should be in the design of the page: Inter, white and one grey, blue links, rounded boxes, no serif (the user, 2.11.2026)', () => {
        const {html} = briefingMail(full);
        expect(html).toContain('family=Inter');
        expect(html).toContain('font:600 38px/1.05 Inter');
        for (const colour of LIGHT_COLOURS) expect(html).toContain(colour);
        expect(html).toContain('border-radius:18px');
        for (const old of ['Fraunces', 'Source Serif', 'Georgia', '#FBF9F4', '#A6301F', 'float:left', 'font-variant:all-small-caps']) {
            expect(html).not.toContain(old);
        }
    });

    // light unless the reader chooses dark for the e-mail, fixed whatever the system of who reads it (the user, 2.11.2026)
    it('should be light by default, with none of the dark colours and no wish to follow the system', () => {
        for (const mail of [briefingMail(full), briefingMail(full, {theme: 'light'}), briefingMail(full, {theme: 'purple'})]) {
            for (const colour of DARK_COLOURS.filter(colour => !LIGHT_COLOURS.includes(colour))) expect(mail.html).not.toContain(colour);
            expect(mail.html).toContain('<meta name="color-scheme" content="light">');
            expect(mail.html).not.toContain('prefers-color-scheme');
            expect(mail.html).toContain('background:#FFFFFF');
        }
    });

    it('should be dark when the reader chooses it, with none of the light colours', () => {
        const {html} = briefingMail(full, {theme: 'dark'});
        for (const colour of DARK_COLOURS) expect(html).toContain(colour);
        for (const colour of LIGHT_COLOURS.filter(colour => !DARK_COLOURS.includes(colour))) expect(html).not.toContain(colour);
        expect(html).toContain('<meta name="color-scheme" content="dark">');
        expect(html).not.toContain('prefers-color-scheme');
        // the page, the boxes, the title and the links
        expect(html).toContain('<body style="margin:0;padding:0;background:#1C1C1E">');
        expect(html).toContain('background:#2C2C2E;border-radius:18px');
        expect(html).toContain('letter-spacing:-.035em;color:#F5F5F7');
        expect(html).toContain('color:#2997FF;text-decoration:none');
    });
});

// the hours of the e-mail are the ones of the reader, not always the ones of Zurich (the user, 2.11.2026)
describe('briefingMail in the time zone of the reader', () => {
    // 23:30 UTC the 8th: 01:30 the 9th in Zurich (summer time), 19:30 the 8th in New York
    const late = {hours: 24, finishedAt: '2026-10-08T23:30:00.000Z', items: [card(1, 'First story', {publishedAt: '2026-10-08T23:30:00.000Z'})]};

    it('should write the hours and the day in Zurich when no time zone is given, or one that is none', () => {
        for (const options of [{}, {timeZone: 'Mars/Phobos'}, {timeZone: ''}, {timeZone: null}]) {
            const mail = briefingMail(late, {profile: 'Football', ...options});
            expect(mail.subject).toBe('Football’s Briefing · 9 October 2026 · 1 story');
            expect(mail.html).toContain('9 Oct, 01:30');
        }
    });

    it('should write them in the time zone of the reader', () => {
        const mail = briefingMail(late, {profile: 'Football', timeZone: 'America/New_York'});
        expect(mail.subject).toBe('Football’s Briefing · 8 October 2026 · 1 story');
        expect(mail.html).toContain('>Football’s Briefing · 8 October 2026<');
        expect(mail.html).toContain('8 Oct, 19:30');
        expect(mail.html).not.toContain('01:30');
        expect(briefingMail(late, {timeZone: 'Asia/Tokyo'}).html).toContain('9 Oct, 08:30');
    });
});

describe('BriefingService.email in the time zone of the reader', () => {
    const sent = () => sendMail.mock.calls.at(-1)[0];

    it('should send the hours of the time zone given, and refuse a name that is none before reading the briefing', async () => {
        ofUser.mockResolvedValue({...row, finished_at: new Date('2026-10-08T23:30:00Z'), items: [card(1, 'First story', {publishedAt: '2026-10-08T23:30:00.000Z'})]});
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'light', 'America/New_York');
        expect(sent().html).toContain('8 Oct, 19:30');
        expect(sent().subject).toContain('8 October 2026');
        await BriefingService.email(4, 7, [1]);
        expect(sent().html).toContain('9 Oct, 01:30');

        ofUser.mockClear();
        sendMail.mockClear();
        for (const zone of ['Mars/Phobos', '', 'x'.repeat(65), 3, {name: 'Europe/Paris'}]) {
            await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'light', zone)).rejects.toMatchObject({status: 400});
        }
        expect(ofUser).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
    });
});

describe('BriefingService.email in the theme the reader chose', () => {
    const sent = () => sendMail.mock.calls.at(-1)[0];

    it('should send in light colours unless dark is asked, and refuse any other theme before reading the briefing', async () => {
        await BriefingService.email(4, 7, [1]);
        expect(sent().html).toContain('background:#FFFFFF');
        expect(sent().html).not.toContain('#1C1C1E');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, null);
        expect(sent().html).toContain('background:#FFFFFF');

        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'dark');
        expect(sent().html).toContain('<body style="margin:0;padding:0;background:#1C1C1E">');
        expect(sent().html).not.toContain('#FFFFFF');
        expect(sent().text).toContain('First story');

        ofUser.mockClear();
        sendMail.mockClear();
        for (const theme of ['auto', 'Dark', 3, {}]) {
            await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, theme)).rejects.toMatchObject({status: 400});
        }
        expect(ofUser).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
    });
});

// The blocks the reader puts in the e-mail and leaves out of it, for each card (the user, 5.11.2026): the badges row, who it is about, the
// coverage and the affair, and the analysis, angles, denials, official sources and unconfirmed words they can leave out
describe('withBlocks', () => {
    const items = [card(1, 'First', {contested: [{by: 'A', sentence: 'No.', source: 's'}], official: [{party: 'B', title: 'T', url: 'https://b.example/1'}],
        hedged: 'reportedly', hedgedTranslation: 'selon', analysis: {why: ['Why.'], next: [], timeline: []}, angles: [{title: 'An angle', url: 'https://x.example/1', source: 'x'}]}), card(2, 'Second')];

    it('should leave the cards as they are without blocks, or for a card without an entry', () => {
        expect(withBlocks(items, undefined)).toBe(items);
        expect(withBlocks(items, null)).toBe(items);
        const [first, second] = withBlocks(items, {2: {names: true}});
        expect(first).toBe(items[0]);
        expect(second.blocks).toMatchObject({names: true, media: false, contested: true, coverage: false});
    });

    it('should give a card with an entry what the page shows at first, and what the entry says', () => {
        const [first] = withBlocks(items, {1: {coverage: true, angles: false}});
        expect(first.blocks).toEqual({media: false, contested: true, official: true, unconfirmed: true, names: false, analysis: true, angles: false, affair: false, coverage: true});
    });

    it('should take from a card what a block at false puts out of the e-mail', () => {
        const [first] = withBlocks(items, {1: {contested: false, official: false, unconfirmed: false, analysis: false, angles: false}});
        expect(first).toMatchObject({contested: [], official: [], hedged: null, hedgedTranslation: null, analysis: null, angles: []});
        const [kept] = withBlocks(items, {1: {media: true}});
        expect(kept).toMatchObject({contested: items[0].contested, official: items[0].official, hedged: 'reportedly', analysis: items[0].analysis, angles: items[0].angles});
    });

    const refused = (blocks) => {
        try {
            withBlocks(items, blocks);
        } catch (err) {
            return err.status;
        }
        return null;
    };

    it('should refuse what is not a blocks of the cards: an object of objects of known blocks, true or false', () => {
        for (const blocks of ['all', 3, [], [{names: true}], {1: true}, {1: null}, {1: []}, {1: {names: 'yes'}}, {1: {names: 1}}, {1: {pictures: true}}, {1: {names: true, unknown: false}}]) {
            expect(refused(blocks)).toBe(400);
        }
    });

    it('should refuse them through the service, before anything is sent', async () => {
        await expect(BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'light', undefined, {1: {names: 'yes'}})).rejects.toMatchObject({status: 400});
        await expect(BriefingService.preview(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'light', undefined, [])).rejects.toMatchObject({status: 400});
        expect(sendMail).not.toHaveBeenCalled();
    });
});

// the badges, the names, the coverage and the affair of the e-mail
describe('briefingMail with the blocks of a card', () => {
    const article = (source, at, language = 'en') => ({source, url: `https://${source}/a`, publishedAt: at, language});
    const at = (hour) => new Date(Date.UTC(2026, 9, 8, hour)).toISOString();
    const full = card(1, 'Gipfel', {
        corroboration: {media: 3, read: 3, independent: 2, agencies: []},
        articles: [article('a.com', at(6)), article('b.fr', at(8), 'fr'), article('c.de', at(8), 'de')],
        names: [{name: 'FIFA'}, {name: 'Infantino', qid: 'Q1'}],
        contested: [{by: 'Infantino', sentence: 'No.', source: 'bild.de', url: 'https://bild.de/a'}],
        official: [{party: 'UEFA', title: 'A post', url: 'https://uefa.com/a', channel: 'site'}, {party: 'FIGC', title: 'Another', url: 'https://figc.it/a', channel: 'site'}],
        hedged: 'reportedly',
    });
    const mail = (item, options) => briefingMail({hours: 24, finishedAt: '2026-10-08T06:01:00.000Z', items: [item]}, options);
    const on = (blocks, item = full) => withBlocks([item], {[item.storyId]: blocks})[0];

    it('should send a card with no entry as before: no badge, no names, no coverage, no affair', () => {
        const {html, text} = mail(full);
        for (const part of ['Who it is about', 'How widely it is told', 'This affair', 'Told by 3 media', 'Unconfirmed', 'border-radius:999px']) {
            expect(html).not.toContain(part);
            expect(text).not.toContain(part);
        }
        expect(html).toContain('>Contested<');
        expect(html).toContain('>Official sources<');
    });

    it('should show under the title the pills of what the card has: the media, the denial, the official sources, the unconfirmed words', () => {
        const {html, text} = mail(on({media: true}));
        expect(html).toContain('Told by 3 media in 3 languages');
        expect(html).toMatch(/color:#BF4800">Contested</);
        expect(html).toMatch(/color:#248A3D">2 official sources</);
        expect(html).toMatch(/color:#BF4800">Unconfirmed</);
        // under the title, before its sentences
        expect(html.indexOf('Told by 3 media')).toBeGreaterThan(html.indexOf('<h2'));
        expect(html.indexOf('Told by 3 media')).toBeLessThan(html.indexOf('Passage of Gipfel'));
        // the tints are plain colours: mail apps do not all read rgba()
        expect(html).not.toContain('rgba(');
        expect(text).toContain('Told by 3 media in 3 languages · Contested · 2 official sources · Unconfirmed');
    });

    it('should say one medium and one official source in the singular, and leave a language count of one out', () => {
        const single = on({media: true}, {...full, corroboration: {media: 1}, articles: [article('a.com', at(6))], official: [full.official[0]], contested: []});
        const {html} = mail(single);
        expect(html).toContain('Told by one medium<');
        expect(html).toContain('>Official source<');
        expect(html).not.toContain('Contested');
    });

    it('should have a badge only for the block that is on and has what it says', () => {
        const {html} = mail(on({contested: false, official: false, unconfirmed: false}));
        expect(html).not.toContain('border-radius:999px');
        expect(html).not.toContain('Contested');
        expect(html).not.toContain('Official source');
        expect(html).not.toContain('Not confirmed');
        const bare = mail(on({media: true, names: true}, card(2, 'Bare', {corroboration: undefined})));
        expect(bare.html).not.toContain('border-radius:999px');
    });

    it('should show who it is about, a pill each, only when asked', () => {
        const {html, text} = mail(on({names: true}));
        expect(html).toContain('>Who it is about<');
        expect(html).toContain('>FIFA</span>');
        expect(html).toContain('>Infantino</span>');
        expect(text).toContain('Who it is about: FIFA, Infantino');
        expect(mail(on({names: false})).html).not.toContain('Who it is about');
        expect(mail(on({names: true}, card(3, 'Nobody'))).html).not.toContain('Who it is about');
    });

    it('should show how widely it is told: the media, the languages, who told it first, the hours as bars, the languages', () => {
        const {html, text} = mail(on({coverage: true}));
        expect(html).toContain('>How widely it is told<');
        expect(html).toContain('3 media · 3 languages');
        expect(html).toMatch(/First told by <a href="https:\/\/a\.com\/a"[^>]*>a\.com<\/a>, 8 Oct/);
        expect(html).toContain('German 1 · English 1 · French 1');
        // a bar a cell of a table, the tallest one the whole height
        expect(html).toMatch(/<td height="44" style="height:44px;background:#/);
        expect(text).toContain('How widely it is told: 3 media · 3 languages. First told by a.com');
        expect(mail(on({coverage: false})).html).not.toContain('How widely it is told');
        expect(mail(on({coverage: true}, card(4, 'No article'))).html).not.toContain('How widely it is told');
    });

    it('should put the affair before the coverage, after the angles, with where to read it up under the sentences and who else covers it at the very bottom', () => {
        const angles = [{title: 'An angle', url: 'https://x.example/1', source: 'x'}];
        const {html} = mail(on({coverage: true, affair: true}, {...full, angles, affair: {title: 'The FIFA files', chip: null, coverage: null,
            events: [{id: 1, at: at(7), kind: 'key', title: 'T', url: 'https://t.example/1', medium: 't.example', media: ['a', 'b'], languages: ['en']}]}}));
        const order = ['Read the article at', 'Same affair, other angles', 'This affair', 'How widely it is told', 'Also covered by'].map(part => html.indexOf(part));
        expect(order.every(place => place > 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    describe('the affair', () => {
        const event = (id, hour, extra = {}) => ({id, at: at(hour), kind: 'key', title: `Event ${id}`, titleTranslation: null, url: `https://news.example/${id}`, medium: 'news.example',
            media: ['a.fr', 'b.fr'], languages: ['en'], reported: false, official: false, denial: false, ...extra});
        const affair = {title: 'The FIFA files', chip: {stories: 15, media: 129}, coverage: {media: 503, news: 1398, languages: [{language: 'en', media: 4}, {language: 'fr', media: 2}]},
            events: [event(3, 12, {official: true}), event(1, 6), event(2, 9, {denial: true, official: true}), event(4, 7, {kind: 'minor'}), event(5, 8, {kind: 'minor'}), event(6, 13, {reported: true, titleTranslation: 'Évènement six'})]};
        const html = () => mail(on({affair: true}, {...full, affair})).html;

        it('should show its title, its figures and its key events, the oldest first', () => {
            const page = html();
            expect(page).toContain('>This affair<');
            expect(page).toContain('>The FIFA files<');
            expect(page).toContain('15 stories told by 129 media');
            expect(page).toContain('503 media · 1,398 news · 2 languages');
            const places = ['Event 1', 'Event 2', 'Event 3', 'Évènement six'].map(title => page.indexOf(title));
            expect(places.every(place => place > 0)).toBe(true);
            expect(places).toEqual([...places].sort((a, b) => a - b));
            expect(page).toContain('href="https://news.example/1"');
            expect(page).toContain('+ 2 smaller events');
            // the events that are not key are not listed
            expect(page).not.toContain('Event 4');
        });

        it('should colour the dot of an event: orange when someone denies it, green when a party announced it, a denial first', () => {
            const page = html();
            const dotOf = (title) => {
                const row = page.slice(page.lastIndexOf('<tr>', page.indexOf(title)), page.indexOf(title));
                return row.match(/border-radius:50%;([^"]*)"/)[1];
            };
            expect(dotOf('Event 1')).toBe('background:#0066CC;border:2px solid #0066CC');
            expect(dotOf('Event 2')).toBe('background:#BF4800;border:2px solid #BF4800');
            expect(dotOf('Event 3')).toBe('background:#248A3D;border:2px solid #248A3D');
            // the articles say it is not confirmed: hollow and dashed
            expect(dotOf('Évènement six')).toBe('background:#FFFFFF;border:2px dashed #0066CC');
        });

        it('should say the marks of an event in the colours of the page, and how many media told it', () => {
            const page = html();
            expect(page).toMatch(/told by 2 media/);
            expect(page).toMatch(/color:#248A3D;font-weight:500">Official</);
            expect(page).toMatch(/color:#BF4800;font-weight:500">Contested</);
            expect(page).toMatch(/color:#BF4800;font-weight:500">Reported</);
        });

        it('should be in the text, and not there when the affair is not asked, nor built', () => {
            const {text} = mail(on({affair: true}, {...full, affair}));
            expect(text).toContain('This affair: The FIFA files');
            expect(text).toContain('15 stories told by 129 media');
            expect(text).toMatch(/ {2}\d+ Oct Event 1 \(news.example\) https:\/\/news.example\/1/);
            expect(text).toContain('+ 2 smaller events');
            expect(mail(on({affair: false}, {...full, affair})).html).not.toContain('This affair');
            expect(mail(on({affair: true}, {...full, affair: null})).html).not.toContain('This affair');
            expect(mail(on({affair: true}, {...full, affair: {...affair, events: []}})).html).not.toContain('This affair');
        });

        it('should say a single smaller event in the singular, and leave the line out when there is none', () => {
            expect(mail(on({affair: true}, {...full, affair: {...affair, events: [event(1, 6), event(4, 7, {kind: 'minor'})]}})).html).toContain('+ 1 smaller event<');
            expect(mail(on({affair: true}, {...full, affair: {...affair, events: [event(1, 6)]}})).html).not.toContain('smaller event');
        });
    });

    it('should write the new words in the language of the reader, left in English where the translation lacks them', () => {
        const labels = {...LABELS, toldByMedia: 'Raconté par {count} médias', inLanguages: 'en {count} langues', contested: 'Contesté', whoItIsAbout: 'De qui il parle'};
        const {html} = mail(on({media: true, names: true}), {language: 'fr', labels});
        expect(html).toContain('Raconté par 3 médias en 3 langues');
        expect(html).toContain('>Contesté<');
        expect(html).toContain('>De qui il parle<');
        expect(html).toContain('Official source');
    });

    it('should take the dark colours of the page for the pills when the reader chooses dark', () => {
        const {html} = mail(on({media: true, names: true}), {theme: 'dark'});
        expect(html).toMatch(/color:#FF9F0A">Contested</);
        expect(html).toMatch(/color:#30D158">2 official sources</);
        expect(html).toContain('background:#2C2C2E;border:1px solid #2C2C2E;color:#98989D');
    });
});

describe('BriefingService.email with the blocks of the cards', () => {
    const sent = () => sendMail.mock.calls.at(-1)[0];
    const asked = (blocks) => BriefingService.email(4, 7, [1], undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'light', undefined, blocks);
    const withData = () => ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {
        contested: [{by: 'Infantino', sentence: 'No.', source: 'bild.de', url: 'https://bild.de/a'}], names: [{name: 'FIFA'}],
        articles: [{source: 'a.com', url: 'https://a.com/1', publishedAt: '2026-10-08T06:00:00.000Z'}],
    })]});
    beforeEach(withData);

    it('should send the card as before when no block is given', async () => {
        await asked(undefined);
        const before = sent().html;
        await asked({});
        expect(sent().html).toBe(before);
        expect(before).toContain('>Contested<');
        expect(before).not.toContain('Who it is about');
    });

    it('should put in the blocks asked and leave out the ones refused', async () => {
        await asked({1: {names: true, coverage: true, contested: false}});
        expect(sent().html).toContain('Who it is about');
        expect(sent().html).toContain('How widely it is told');
        expect(sent().html).not.toContain('Infantino');
        expect(sent().text).toContain('Who it is about: FIFA');
    });

    it('should leave the lines the reader took out out, on top of the blocks', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'First story', {
            contested: [{by: 'Infantino', sentence: 'No.', source: 'bild.de'}, {by: 'Ceferin', sentence: 'Never.', source: 'x.com'}]})]});
        await BriefingService.email(4, 7, [1], undefined, undefined, undefined, {1: {contested: [0]}}, 'passages', [], undefined, undefined, 'light', undefined, {1: {media: true}});
        expect(sent().html).toContain('Ceferin');
        expect(sent().html).not.toContain('Infantino');
        expect(sent().html).toContain('>Contested<');
    });

    it('should ask the affair of the cards that ask for it, and only those', async () => {
        forMail.mockResolvedValue({title: 'The FIFA files', chip: null, coverage: null, events: [{id: 1, at: '2026-10-07T10:00:00.000Z', kind: 'key', title: 'An event', url: 'https://n.example/1', medium: 'n.example', media: ['a', 'b']}]});
        await asked({1: {names: true}});
        expect(forMail).not.toHaveBeenCalled();
        await asked({1: {affair: true}});
        expect(forMail).toHaveBeenCalledTimes(1);
        expect(forMail).toHaveBeenCalledWith(4, 7, 1);
        expect(sent().html).toContain('>The FIFA files<');
        expect(sent().html).toContain('An event');
    });

    it('should send the e-mail without the affair when it cannot be built, and say why in the log', async () => {
        const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
        forMail.mockRejectedValue(new Error('the AI is down'));
        await asked({1: {affair: true, names: true}});
        expect(sent().html).toContain('Who it is about');
        expect(sent().html).not.toContain('This affair');
        expect(quiet).toHaveBeenCalledWith(expect.stringContaining('the AI is down'));
        // no affair behind the card either
        forMail.mockReset().mockResolvedValue(null);
        await asked({1: {affair: true}});
        expect(sent().html).not.toContain('This affair');
        quiet.mockRestore();
    });
});

describe('withAffairs', () => {
    it('should give each card that asks for it its own affair, and leave the others as they are', async () => {
        const items = [{storyId: 1, blocks: {affair: true}}, {storyId: 2, blocks: {affair: false}}, {storyId: 3}, {storyId: 4, blocks: {affair: true}}];
        forMail.mockImplementation(async (userId, briefingId, storyId) => storyId === 4 ? null : {title: `Affair ${storyId}`});
        const result = await withAffairs(items, 4, 7);
        expect(result[0].affair).toEqual({title: 'Affair 1'});
        expect(result[1]).toBe(items[1]);
        expect(result[2]).toBe(items[2]);
        expect(result[3].affair).toBeNull();
        expect(await withAffairs([items[2]], 4, 7)).toEqual([items[2]]);
    });
});

// the preview of the editor: the same e-mail, shown, never sent (the user chose it with the live preview, 5.11.2026)
describe('BriefingService.preview', () => {
    const preview = (...args) => BriefingService.preview(4, 7, [1, 3], ...args);
    beforeEach(() => ofUser.mockResolvedValue({...row, items: [
        card(1, 'First story', {thumbnail: 'https://93.184.215.14/first.jpg', thumbnailSource: 'media.fr', why: 'For you.'}),
        card(2, 'Second story'), card(3, 'Third story'),
    ]}));

    it('should answer the page of the e-mail, and send nothing nor mark any story as read', async () => {
        const {html} = await preview();
        expect(html).toContain('First story');
        expect(html).toContain('Third story');
        expect(html).not.toContain('Second story');
        expect(sendMail).not.toHaveBeenCalled();
        expect(markSent).not.toHaveBeenCalled();
    });

    // the editor shows in it the story the reader chose, by this place (the user, 5.11.2026: a click on a story shows it)
    it('should give each card a place of its own, which the e-mail sent does not have', async () => {
        const {html} = await preview();
        expect(html).toContain('<tr id="story-1">');
        expect(html).toContain('<tr id="story-3">');
        expect(html).not.toContain('id="story-2"');
        await BriefingService.email(4, 7, [1, 3]);
        expect(sendMail.mock.calls[0][0].html).not.toMatch(/id="story-/);
    });

    it('should open its links in a tab of their own', async () => {
        const {html} = await preview();
        expect(html).toContain('<head><base target="_blank">');
    });

    it('should show the pictures the reader joined as data, not as the cid: of a mail', async () => {
        const {html} = await preview(undefined, {3: {data: PNG}});
        expect(html).not.toContain('cid:');
        expect(html).toContain(`src="data:image/png;base64,${PNG}"`);
    });

    it('should be the e-mail that email sends, blocks, order and theme included, apart from what shows it', async () => {
        const args = [undefined, undefined, {1: 'A title of mine'}, undefined, 'points', [], undefined, undefined, 'dark', undefined, {1: {names: true}, 3: {coverage: true}}];
        const {html} = await preview(...args);
        await BriefingService.email(4, 7, [1, 3], ...args);
        // but for the place of each card, which the editor shows the one chosen by
        expect(previewHtml(sendMail.mock.calls[0][0].html)).toBe(html.replace(/ id="story-\d+"/g, ''));
        expect(html).toContain('A title of mine');
        expect(html).toContain('background:#1C1C1E');
    });

    it('should not refuse the address the reader is still typing, and take the one of the account for it', async () => {
        for (const to of ['read', 'reader@', 'reader@example', 3, {}]) {
            await expect(preview(to)).resolves.toEqual({html: expect.any(String)});
        }
        // the same as the account's: not to another, the reasons for the cards stay; to another, they leave
        expect((await preview('reader@example.test')).html).toContain('For you.');
        expect((await preview('friend@example.org')).html).not.toContain('For you.');
        // while e-mail refuses a wrong address
        await expect(BriefingService.email(4, 7, [1], 'reader@')).rejects.toMatchObject({status: 400});
    });

    it('should refuse what email refuses: no card ticked, none of this briefing, an unknown format or theme, a briefing that is not ready', async () => {
        await expect(BriefingService.preview(4, 7, [])).rejects.toMatchObject({status: 400});
        await expect(BriefingService.preview(4, 7, [99])).rejects.toMatchObject({status: 404});
        await expect(preview(undefined, undefined, undefined, undefined, 'tweets')).rejects.toMatchObject({status: 400});
        await expect(preview(undefined, undefined, undefined, undefined, 'passages', [], undefined, undefined, 'auto')).rejects.toMatchObject({status: 400});
        ofUser.mockResolvedValue({...row, status: 'running'});
        await expect(preview()).rejects.toMatchObject({status: 404});
    });
});

describe('previewHtml', () => {
    it('should put the files joined in the page and open the links in a tab of their own', () => {
        const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><img src="cid:a@x"><img src="cid:a@x"><img src="cid:b@x"></body></html>';
        const page = previewHtml(html, [{cid: 'a@x', contentType: 'image/png', content: Buffer.from('AB')}, {cid: 'b@x', contentType: 'image/jpeg', content: Buffer.from('C')}]);
        expect(page).toBe(html.replace('<head>', '<head><base target="_blank">').replaceAll('cid:a@x', 'data:image/png;base64,QUI=').replace('cid:b@x', 'data:image/jpeg;base64,Qw=='));
        expect(previewHtml(html)).toBe(html.replace('<head>', '<head><base target="_blank">'));
    });
});

// the titles of the parts of a card are titles, and its links are of three kinds (the user, 06.11.2026: the titles "trop petits", links
// "soulignés en bleu", "gris souligné" and "gris non souligné" mixed)
describe('briefingMail, its titles and its links', () => {
    const news = (source, url) => ({source, url, publishedAt: '2026-10-08T06:00:00.000Z', language: 'sr'});
    const serbian = card(1, 'Gipfel', {
        lead: {source: 'nova.rs', url: 'https://nova.rs/1', language: 'sr'},
        articles: [news('nova.rs', 'https://nova.rs/1'), news('klix.ba', 'https://klix.ba/2'), news('fss.rs', 'https://fss.rs/3')],
        thumbnail: 'https://cdn.example/a.jpg', thumbnailSource: 'lapresse.tn',
        angles: [{title: 'Elections when it is not their time', url: 'https://danas.rs/1', source: 'danas.rs', language: 'sr', publishedAt: '2026-11-02T17:00:00.000Z'}],
        analysis: {why: ['Because.'], next: [], timeline: [
            {date: '2026-11-02', title: 'The first one', url: 'https://fss.rs/9', medium: 'fss.rs'},
            {date: '2026-11-01', title: 'The second one', url: null, medium: 'sportklub.rs'},
        ]},
    });
    const mailOf = (changes = {}) => briefingMail({items: [{...serbian, ...changes}], createdAt: new Date('2026-11-05T06:00:00Z')});

    it('should write the title of each part as a title: 18 px in semibold and the ink, not a small grey label', () => {
        const {html} = mailOf();
        for (const title of ['Key passages', 'Why it matters', 'Same affair, other angles']) {
            expect(html).toMatch(new RegExp(`<p style="font:600 18px/1[.]3 [^"]*color:#1D1D1F;margin:0">${title}</p>`));
        }
        expect(html).not.toContain('font:500 13px/1.3');
    });

    it('should keep the colour of a box on its title: orange for the denials, green for the official sources', () => {
        const {html} = mailOf({contested: [{by: 'A', sentence: 'No.', source: 'bild.de', url: 'https://bild.de/a'}], official: [{party: 'UEFA', title: 'A post', url: 'https://uefa.com/a', channel: 'site'}]});
        expect(html).toMatch(/font:600 18px[^"]*margin:0;color:#BF4800">Contested</);
        expect(html).toMatch(/font:600 18px[^"]*margin:0;color:#248A3D">Official sources</);
    });

    it('should put the link to the article right under the sentences, and who else covers it at the very bottom (the user, 06.11.2026)', () => {
        const {html, text} = mailOf({official: [{party: 'UEFA', title: 'A post', url: 'https://uefa.com/a', channel: 'site'}]});
        const order = ['Another passage.', 'Read the article at nova.rs', 'Official sources', 'Why it matters', 'Same affair, other angles', 'Also covered by'].map(part => html.indexOf(part));
        expect(order.every(place => place > 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        // the text of the e-mail too
        expect(text.indexOf('Read the article at nova.rs')).toBeGreaterThan(text.indexOf('Another passage.'));
        expect(text.indexOf('Read the article at nova.rs')).toBeLessThan(text.indexOf('Why it matters'));
    });

    it('should show the name of a medium of a news as a grey link with a hairline, wherever it is written: the angles, the story so far, who else covers it', () => {
        const {html} = mailOf();
        const grey = 'style="color:#6E6E73;text-decoration:underline;text-decoration-color:#D2D2D7;text-underline-offset:3px"';
        for (const [url, name] of [['https://danas.rs/1', 'danas.rs'], ['https://fss.rs/9', 'fss.rs'], ['https://klix.ba/2', 'klix.ba']]) {
            expect(html).toContain(`<a href="${url}" ${grey}>${name}</a>`);
        }
    });

    it('should show the title of an item of a list as a link in the ink with the same hairline, the angles included', () => {
        const {html} = mailOf();
        const ink = 'color:#1D1D1F;text-decoration:underline;text-decoration-color:#D2D2D7;text-underline-offset:3px';
        expect(html).toMatch(new RegExp(`<a href="https://danas[.]rs/1" style="[^"]*${ink}">Elections when it is not their time</a>`));
        expect(html).toContain(`<a href="https://fss.rs/9" style="${ink}">The first one</a>`);
    });

    it('should break a name that looks like an address where it is no link, so a phone does not turn it into a blue one', () => {
        const {html} = mailOf();
        expect(html).toContain('sportklub.&#8203;rs');
        expect(html).not.toContain('sportklub.rs');
        expect(html).toContain('Picture — lapresse.&#8203;tn');
    });

    it('should leave the link to the article in the blue of the action: the only blue link', () => {
        const {html} = mailOf();
        expect(html).toContain('<a href="https://nova.rs/1" style="color:#0066CC;text-decoration:none">Read the article at nova.rs</a>');
        expect(html.match(/color:#0066CC/g)).toHaveLength(1);
    });
});
