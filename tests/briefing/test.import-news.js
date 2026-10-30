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
const cardOfLinks = jest.fn(async () => null);
const addAnalysisLines = jest.fn(async () => 1);
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
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, addItem, removeItem, cardOfLinks, addAnalysisLines, articlePictures: jest.fn(async () => []), markSent: jest.fn(async () => 1)}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test', username: 'lecteur'}))}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async () => ({name: 'Roberto', text: 'Je lis en français.', languages: ['fr'], watch_terms: ['SBB']}))}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({sendMail, mailEnabled: () => true}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Pages: pages, Html: pages}}));
const aiWaysOf = jest.fn(async () => null);
jest.unstable_mockModule('../../services/utils/ai-ways.js', () => ({aiWaysOf}));
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
    cardOfLinks.mockReset().mockResolvedValue(null);
    addAnalysisLines.mockClear();
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
        const {item, analysis} = await BriefingService.importNews(4, '7', ' https://news.example/strike ');

        expect(pages).toHaveBeenCalledWith(['https://news.example/strike']);
        expect(extractArticle).toHaveBeenCalledWith('SBB: train strike on Monday', page, expect.objectContaining({language: 'fr'}));
        const [userId, briefingId, added, conditions] = addItem.mock.calls[0];
        expect([userId, briefingId]).toEqual([4, 7]);
        // checked again by the statement that adds it
        expect(conditions).toEqual({max: 10, links: ['https://news.example/strike']});
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
        // nothing was looked for in the other briefings but a card, and none came with an analysis
        expect(cardOfLinks).toHaveBeenCalledWith(4, 7, ['https://news.example/strike', 'https://news.example/strike/'], 7);
        expect(analysis).toBeNull();
        expect(addAnalysisLines).not.toHaveBeenCalled();
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

    it('should not ask the AI versions of a page that gives no passage of a news', async () => {
        aiWaysOf.mockClear();
        extractArticle.mockResolvedValueOnce({passages: [], translation: null, points: [], pointsTranslation: null, digest: [], digestTranslation: null,
            from: null, topic: null, sourcing: null});

        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 422});
        expect(aiWaysOf).not.toHaveBeenCalled();
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should refuse an eleventh news added to one briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [...row.items, ...Array.from({length: 10}, (_, i) => ({...card(-i - 1, `https://x.example/${i}`), imported: true}))]});
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 400});
    });

    it('should say why when the same news, added at the same time, was added first', async () => {
        addItem.mockResolvedValueOnce(null);
        ofUser.mockResolvedValueOnce(row).mockResolvedValueOnce({...row, items: [...row.items, {...card(-1, 'https://news.example/strike'), imported: true}]});

        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 409});
    });
});

describe('BriefingService.importNews of a news another briefing of the reader has', () => {
    // the card as the briefing of another profile wrote it, with its analysis
    const lines = {why: ['A decisive week for the federation.'], next: [{if: 'it votes', then: 'a president is chosen'}], timeline: []};
    const other = {
        storyId: 1701277, title: 'Galliani backed', titleTranslation: null, language: 'en', topic: 'sport', summary: 'Galliani is backed.', translation: '',
        why: 'Chosen for Enzo.', interest: 'Federations', project: 'A project', vote: 'up', sentAt: '2026-10-30T08:00:00Z', followUp: {storyId: 5},
        feedUrls: ['https://feed.example/rss'], mergedStoryIds: [9], ai: {points: ['One.'], summary: 'Two.', model: 'm'},
        lead: {url: 'https://news.example/strike', source: 'news.example', language: 'en'}, articles: [{url: 'https://news.example/strike'}, {url: 'https://other.example/a'}],
        angles: [{title: 'Another angle', url: 'https://angle.example/1'}], official: [{party: 'FIGC', title: 'Statement'}], contested: [],
        corroboration: {media: 3}, names: [{name: 'Galliani', qid: null, kind: 'human'}], thumbnail: 'https://news.example/p.jpg',
    };
    beforeEach(() => cardOfLinks.mockResolvedValue({briefingId: 5, idProfile: 3, card: other, lines}));

    it('should copy its card with its angles, official sources and analysis instead of reading the page', async () => {
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');

        expect(pages).not.toHaveBeenCalled();
        expect(extractArticle).not.toHaveBeenCalled();
        const [, , added, conditions] = addItem.mock.calls[0];
        // every article of the card is looked for in this briefing, not only the address pasted
        expect(conditions.links).toEqual(expect.arrayContaining(['https://news.example/strike', 'https://other.example/a']));
        expect(added).toMatchObject({
            imported: true, transferred: true, title: 'Galliani backed', angles: other.angles, official: other.official, ai: other.ai,
            corroboration: {media: 3}, names: other.names, thumbnail: 'https://news.example/p.jpg',
            // what was for the other profile only
            why: null, interest: null, project: null, vote: null, followUp: null, feedUrls: [], mergedStoryIds: [],
        });
        expect(added.storyId).toBeUndefined();
        expect(added.sentAt).toBeUndefined();
        // its analysis lines are saved for this briefing's card, and given to the page
        expect(addAnalysisLines).toHaveBeenCalledWith(4, 7, -1, lines);
        expect(analysis).toEqual(lines);
        expect(item).toMatchObject({storyId: -1, angles: other.angles, official: other.official});
    });

    it('should copy the card alone when the analysis of this briefing is not written', async () => {
        addAnalysisLines.mockResolvedValueOnce(0);
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(item.angles).toMatchObject(other.angles);
        expect(analysis).toBeNull();
    });

    it('should copy the card without lines when the other briefing has none for it', async () => {
        cardOfLinks.mockResolvedValue({briefingId: 5, idProfile: 3, card: other, lines: null});
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(item.official).toEqual(other.official);
        expect(analysis).toBeNull();
        expect(addAnalysisLines).not.toHaveBeenCalled();
    });

    it('should read the page when the other briefing was written for a reader of another language', async () => {
        const { ProfileModel } = await import('../../models/profile-model.js');
        ProfileModel.get.mockResolvedValueOnce({name: 'Roberto', text: '', languages: ['fr'], watch_terms: []})
            .mockResolvedValueOnce({name: 'Enzo', text: '', languages: ['en'], watch_terms: []});
        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(pages).toHaveBeenCalled();
        expect(item.transferred).toBeUndefined();
        expect(addAnalysisLines).not.toHaveBeenCalled();
    });

    it('should refuse it when one of its articles is already on a card of this briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'https://other.example/a')]});
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 409});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should read the page when the search of the other briefings fails', async () => {
        cardOfLinks.mockRejectedValue(new Error('db down'));
        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(pages).toHaveBeenCalled();
        expect(item.imported).toBe(true);
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
        // the words of the e-mail in the reader's language, French here
        const french = {'{name}’s Briefing': 'Le briefing de {name}', '{count} stories': '{count} nouvelles'};
        translateTexts.mockImplementationOnce(async (texts) => texts.map(({text}) => french[text] ?? null));
        await BriefingService.email(4, 7, [-1, 1]);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.text.indexOf('01. Added news')).toBeGreaterThan(0);
        expect(mail.subject).toBe('Le briefing de Roberto · 13 octobre 2026 · 2 nouvelles');
    });
});
