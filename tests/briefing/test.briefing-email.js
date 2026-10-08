//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.briefing-email.js
//  Description: The cards of a briefing the reader ticked sent by e-mail, always to the address of the
//               account, in the order of the briefing, laid out as the page shows them
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const sendMail = jest.fn(async () => {});
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test'}))}}));
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
    it('should send only the cards ticked, in the order of the briefing, to the address of the account', async () => {
        await BriefingService.email(4, '7', [3, 1]);

        expect(ofUser).toHaveBeenCalledWith(4, 7);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe('reader@example.test');
        expect(mail.subject).toMatch(/^Your briefing · Football · 2 stories · /);
        expect(mail.text.indexOf('01. First story')).toBeGreaterThan(0);
        expect(mail.text).toContain('02. Third story');
        expect(mail.text).not.toContain('Second story');
        expect(mail.text).not.toContain('A VAR news');
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

    it('should escape the texts and never link nor show an address that is not of the web', () => {
        const {html} = briefingMail(briefing, null);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('javascript:');
    });
});
