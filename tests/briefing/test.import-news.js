//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.import-news.js
//  Description: A news the reader adds to a ready briefing by its link: its page read, its passages
//               chosen and translated as a card's, added at the end with a negative id, and sent by
//               e-mail with the cards; a page already in the briefing, unreadable or private refused
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const addItem = jest.fn(async () => -1);
const removeItem = jest.fn(async () => 1);
const sendMail = jest.fn(async () => {});
const pages = jest.fn();
const extractArticle = jest.fn();
const translateTexts = jest.fn(async () => ['Grève des trains']);
const lookup = jest.fn(async () => [{address: '93.184.215.14', family: 4}]);
jest.unstable_mockModule('node:dns/promises', () => ({default: {lookup}, lookup}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
// what the profile follows: its words only
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {
    followTerms: async (profileId, words) => (words ?? []).map(word => ({label: word, qid: null, names: [word]})),
}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, addItem, removeItem, articlePictures: jest.fn(async () => [])}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test', username: 'lecteur'}))}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async () => ({name: 'Roberto', text: 'Je lis en français.', languages: ['fr'], watch_terms: ['SBB']}))}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({sendMail, mailEnabled: () => true}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Pages: pages, Html: pages}}));
const extract = await import('../../services/utils/extract.js');
jest.unstable_mockModule('../../services/utils/extract.js', () => ({...extract, extractArticle, translateTexts}));
const {BriefingService} = await import('../../services/briefing-service.js');

const card = (storyId, url) => ({storyId, title: `Story ${storyId}`, summary: 'A passage.', lead: {source: 'media.fr', url, language: 'fr'}, articles: []});
const row = {id: 7, id_profile: 3, status: 'ready', hours: 24, finished_at: new Date('2026-10-13T06:00:00Z'), items: [card(1, 'https://media.fr/1')]};
const page = {url: 'https://news.example/strike', title: 'SBB: train strike on Monday', description: 'Trains stop.', thumbnail: 'https://news.example/p.jpg',
    publishedAt: '2026-10-13T05:00:00Z', content: 'word '.repeat(200), blocks: []};

beforeEach(() => {
    ofUser.mockReset().mockResolvedValue(row);
    addItem.mockClear();
    sendMail.mockClear();
    pages.mockReset().mockResolvedValue([page]);
    extractArticle.mockReset().mockResolvedValue({
        passages: [[{text: 'Trains will stop on Monday.'}]], translation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        points: [[{text: 'Trains will stop on Monday.'}]], pointsTranslation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        digest: [[{text: 'Trains will stop on Monday.'}]], digestTranslation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        from: 'en', topic: 'transport', sourcing: 'named',
    });
});

describe('BriefingService.importNews', () => {
    it('should read the page, choose and translate its passages as a card, and add it at the end with its id', async () => {
        const item = await BriefingService.importNews(4, '7', ' https://news.example/strike ');

        expect(pages).toHaveBeenCalledWith(['https://news.example/strike']);
        expect(extractArticle).toHaveBeenCalledWith('SBB: train strike on Monday', page, expect.objectContaining({language: 'fr'}));
        const [userId, briefingId, added] = addItem.mock.calls[0];
        expect([userId, briefingId]).toEqual([4, 7]);
        expect(added).toMatchObject({
            imported: true, title: 'SBB: train strike on Monday', titleTranslation: 'Grève des trains', language: 'en',
            summary: 'Trains will stop on Monday.', translation: 'Les trains s’arrêteront lundi.', topic: 'transport',
            lead: {url: 'https://news.example/strike', source: 'news.example', publishedAt: '2026-10-13T05:00:00.000Z'},
            thumbnail: 'https://news.example/p.jpg', thumbnailSource: 'news.example', why: null, contested: [], angles: [], official: [],
        });
        // no count of media: nothing compared it with others
        expect(added.corroboration).toBeUndefined();
        expect(item.storyId).toBe(-1);
        // the terms the profile follows marked in it
        expect(item.marks.title).toEqual([[0, 3]]);
    });

    it('should refuse a news already on a card, a private address, and a page with no article, adding nothing', async () => {
        await expect(BriefingService.importNews(4, 7, 'https://media.fr/1')).rejects.toMatchObject({status: 409});
        await expect(BriefingService.importNews(4, 7, 'file:///etc/passwd')).rejects.toMatchObject({status: 400});
        lookup.mockResolvedValueOnce([{address: '192.168.1.135', family: 4}]);
        await expect(BriefingService.importNews(4, 7, 'https://intranet.example/a')).rejects.toMatchObject({status: 400});
        pages.mockResolvedValueOnce([]);
        await expect(BriefingService.importNews(4, 7, 'https://news.example/paywall')).rejects.toMatchObject({status: 422});
        await expect(BriefingService.importNews(4, 7, '')).rejects.toMatchObject({status: 400});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should refuse an eleventh news added to one briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [...row.items, ...Array.from({length: 10}, (_, i) => ({...card(-i - 1, `https://x.example/${i}`), imported: true}))]});
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 400});
    });
});

describe('BriefingService.removeNews', () => {
    it('should take out a news added, never a card of the briefing', async () => {
        await BriefingService.removeNews(4, '7', '-1');
        expect(removeItem).toHaveBeenCalledWith(4, 7, -1);
        await expect(BriefingService.removeNews(4, 7, '1')).rejects.toMatchObject({status: 404});
        removeItem.mockResolvedValueOnce(0);
        await expect(BriefingService.removeNews(4, 7, '-9')).rejects.toMatchObject({status: 404});
    });
});

describe('BriefingService.email with a news added', () => {
    it('should send the news added with the cards ticked, by its negative id', async () => {
        ofUser.mockResolvedValue({...row, items: [...row.items, {...card(-1, 'https://news.example/strike'), title: 'Added news', imported: true}]});
        await BriefingService.email(4, 7, [-1, 1]);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.text.indexOf('01. Added news')).toBeGreaterThan(0);
        expect(mail.subject).toBe('Roberto’s Briefing · 2 stories · 13 October 2026');
    });
});
