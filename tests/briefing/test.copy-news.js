//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.copy-news.js
//  Description: A news of the briefing of another profile of the account, listed and copied into the briefing the reader is in, from the editor of
//               the e-mail (BriefingService.profilesNews and copyNews)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const profilesNews = jest.fn(async () => []);
const addItem = jest.fn(async () => -1);
const addAnalysisLines = jest.fn(async () => 1);
const foldItems = jest.fn(async () => 1);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {
    followTerms: async (profileId, words) => (words ?? []).map(word => ({label: word, qid: null, names: [word]})),
}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, profilesNews, addItem, addAnalysisLines, foldItems}}));
const profiles = {3: {name: 'Roberto', languages: ['en'], watch_terms: ['Wenger']}, 4: {name: 'Chris', languages: ['en'], watch_terms: []},
    5: {name: 'Enzo', languages: ['fr'], watch_terms: []}};
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async (id) => profiles[id] ?? null)}}));
const {BriefingService} = await import('../../services/briefing-service.js');
const {printOf} = await import('../../services/utils/card-versions.js');

const card = (storyId, source, extra = {}) => ({storyId, mergedStoryIds: [], title: `News of ${source}`, why: `Why for ${source}`, interest: 'interest', vote: 'up', sentAt: '2026-11-09T08:00:00Z',
    followUp: null, lead: {source, url: `https://${source}/a`}, summary: 'Passages.', articles: [{url: `https://${source}/a`}, {url: `https://${source}/b`}],
    angles: [{title: 'Angle'}], thumbnail: `https://${source}/p.jpg`, ...extra});
const now = new Date().toISOString();
const here = {id: 507, id_profile: 3, status: 'ready', items: [card(10, 'lesoir.be'), card(20, 'bbc.co.uk')], analysis: null, created_at: new Date(now)};
const there = {id: 508, id_profile: 4, status: 'ready', items: [card(30, 'hln.be', {countries: ['BE']}), card(10, 'lemonde.fr', {mergedStoryIds: [11]}), card(-2, 'added.example', {imported: true})],
    analysis: {status: 'ready', cards: {30: {why: ['theirs'], next: []}}}, created_at: new Date(now)};

beforeEach(() => {
    ofUser.mockReset().mockImplementation(async (userId, id) => ({507: here, 508: there, 509: {...there, id: 509, id_profile: 5}}[id] ?? null));
    profilesNews.mockReset().mockResolvedValue([]);
    addItem.mockReset().mockResolvedValue(-1);
    addAnalysisLines.mockReset().mockResolvedValue(1);
    foldItems.mockReset().mockResolvedValue(1);
});

describe('BriefingService.profilesNews', () => {
    const row = (idProfile, briefingId, cards) => ({idProfile, briefingId, createdAt: new Date(now), cards});
    const news = (number, storyId, title, links, ids = [storyId]) => ({number, storyId, ids, title, source: 'hln.be', language: 'nl', thumbnail: null, imported: false, links});

    it('should list the news of the newest briefing of each other profile that reads in the language of this one, in their order', async () => {
        profilesNews.mockResolvedValue([row(4, 508, [news(1, 30, 'A news', ['https://hln.be/a']), news(2, 31, 'Another', ['https://hln.be/b'])]), row(5, 600, [news(1, 40, 'Fr', [])])]);
        const answer = await BriefingService.profilesNews(482, 507);
        expect(profilesNews).toHaveBeenCalledWith(482, 507, 3, 7);
        expect(answer.profiles).toHaveLength(1);
        expect(answer.profiles[0]).toMatchObject({idProfile: 4, profile: 'Chris', briefingId: 508});
        expect(answer.profiles[0].news.map(one => [one.number, one.storyId, one.title, one.inBriefing])).toEqual([[1, 30, 'A news', false], [2, 31, 'Another', false]]);
        // what the model gives for the check only (links, ids) does not go to the page
        expect(answer.profiles[0].news[0]).not.toHaveProperty('links');
        expect(answer.profiles[0].news[0]).not.toHaveProperty('ids');
        expect(answer).toMatchObject({added: 0, max: 10});
    });

    it('should say a news is already here only when exactly the same card is: the same article and the same words', async () => {
        profilesNews.mockResolvedValue([row(4, 508, [
            // the card 20 of this briefing, word for word
            {...news(1, 30, 'The same card', ['https://bbc.co.uk/a']), print: printOf(here.items[1])},
            // the same article and the same title, another summary written by the AI
            {...news(2, 31, 'Same article, other words', ['https://bbc.co.uk/a']), print: printOf({...here.items[1], ai: {points: ['Other words.']}})},
            {...news(3, 32, 'Other', ['https://other.example/y'])}])]);
        const {profiles: [chris]} = await BriefingService.profilesNews(482, 507);
        expect(chris.news.map(one => one.inBriefing)).toEqual([true, false, false]);
    });

    it('should give the place of the card of this briefing that tells the same news, to say it, never to refuse it: an article on it, or a version of it', async () => {
        profilesNews.mockResolvedValue([row(4, 508, [
            news(1, 30, 'Same article', ['https://hln.be/x', 'https://bbc.co.uk/b']),
            news(2, 31, 'Version of the card 10', ['https://other.example/z'], [31, 10]),
            news(3, 32, 'Other', ['https://other.example/y'])])]);
        const {profiles: [chris]} = await BriefingService.profilesNews(482, 507);
        expect(chris.news.map(one => [one.inBriefing, one.similarTo])).toEqual([[false, 2], [false, 1], [false, null]]);
        // what the model gives for the check only does not go to the page
        for (const one of chris.news) for (const key of ['links', 'ids', 'print']) expect(one).not.toHaveProperty(key);
    });

    it('should count the news added to this briefing, and give none for a profile with no recent briefing', async () => {
        ofUser.mockImplementation(async () => ({...here, items: [...here.items, card(-1, 'added.example', {imported: true}), card(-2, 'added2.example', {imported: true})]}));
        expect(await BriefingService.profilesNews(482, 507)).toEqual({profiles: [], added: 2, max: 10});
    });

    it('should refuse a briefing that is not a ready one of the reader', async () => {
        ofUser.mockImplementation(async () => null);
        await expect(BriefingService.profilesNews(482, 507)).rejects.toMatchObject({status: 404});
    });
});

describe('BriefingService.copyNews', () => {
    it('should add the card of the other briefing at the end of this one, as a news copied with its analysis, what was for the other profile left out', async () => {
        const {item, analysis, analyzing} = await BriefingService.copyNews(482, 507, 508, 30);
        expect(addItem).toHaveBeenCalledTimes(1);
        const [userId, briefingId, saved, options] = addItem.mock.calls[0];
        expect([userId, briefingId]).toEqual([482, 507]);
        expect(saved).toMatchObject({title: 'News of hln.be', imported: true, transferred: true, mergedStoryIds: [], followUp: null, vote: null, why: null, interest: null, countries: ['BE'], angles: [{title: 'Angle'}]});
        expect(saved).not.toHaveProperty('storyId');
        expect(saved).not.toHaveProperty('sentAt');
        expect(options).toEqual({max: 10, links: []});
        expect(addAnalysisLines).toHaveBeenCalledWith(482, 507, -1, {why: ['theirs'], next: []});
        expect(item).toMatchObject({storyId: -1, title: 'News of hln.be'});
        expect(analysis).toEqual({why: ['theirs'], next: []});
        expect(analyzing).toBe(false);
    });

    it('should add a card with no analysis ready without lines, and mark the words the profile follows', async () => {
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [card(10, 'wenger.example', {title: 'Wenger'})]}, 508: {...there, analysis: null}}[id] ?? null));
        const {item, analysis} = await BriefingService.copyNews(482, 507, 508, 30);
        expect(addAnalysisLines).not.toHaveBeenCalled();
        expect(analysis).toBeNull();
        expect(item.storyId).toBe(-1);
    });

    it('should copy a news the other profile had added itself (a negative id)', async () => {
        await BriefingService.copyNews(482, 507, 508, -2);
        expect(addItem.mock.calls[0][2]).toMatchObject({title: 'News of added.example', imported: true});
    });

    it('should copy a news close to a card of this briefing, one of its articles being on it, and tell the statement to refuse no link (the user: only the exact same news is refused)', async () => {
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [card(10, 'lesoir.be'), card(11, 'dup.example', {articles: [{url: 'https://hln.be/b'}]})]}, 508: there}[id] ?? null));
        const {item} = await BriefingService.copyNews(482, 507, 508, 30);
        expect(item).toMatchObject({storyId: -1, title: 'News of hln.be'});
        expect(addItem.mock.calls[0][3]).toEqual({max: 10, links: []});
    });

    it('should copy the card of the same story that the briefing already has, written by this profile with other words', async () => {
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [card(30, 'hln.be', {ai: {points: ['Mine.']}})]}, 508: there}[id] ?? null));
        await BriefingService.copyNews(482, 507, 508, 30);
        expect(addItem).toHaveBeenCalledTimes(1);
    });

    it('should refuse exactly the same card: the same article, the same words', async () => {
        // a card copied before, as the other briefing shows it
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [card(10, 'lesoir.be'), card(-3, 'hln.be', {imported: true, transferred: true})]}, 508: there}[id] ?? null));
        await expect(BriefingService.copyNews(482, 507, 508, 30)).rejects.toMatchObject({status: 409, message: 'This exact news is already in the briefing.'});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should refuse past the 10 news added, and when another news added meanwhile took the place', async () => {
        const added = Array.from({length: 10}, (_, i) => card(-(i + 10), `added${i}.example`, {imported: true}));
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [...here.items, ...added]}, 508: there}[id] ?? null));
        await expect(BriefingService.copyNews(482, 507, 508, 30)).rejects.toMatchObject({status: 400});
        // the statement refuses (null) what the check let pass: another news added at the same time
        ofUser.mockImplementation(async (userId, id) => ({507: here, 508: there}[id] ?? null));
        addItem.mockResolvedValue(null);
        ofUser.mockImplementationOnce(async () => here).mockImplementationOnce(async () => there).mockImplementationOnce(async () => ({...here, items: [...here.items, card(-5, 'hln.be', {imported: true, transferred: true})]}));
        await expect(BriefingService.copyNews(482, 507, 508, 30)).rejects.toMatchObject({status: 409});
    });

    it('should refuse what is not a news of another profile\'s recent briefing of this language, with the right status', async () => {
        await expect(BriefingService.copyNews(482, 507, 'x', 30)).rejects.toMatchObject({status: 400});
        await expect(BriefingService.copyNews(482, 507, 508, 0)).rejects.toMatchObject({status: 400});
        // the same briefing, a briefing that is not there, a news that is not in it
        await expect(BriefingService.copyNews(482, 507, 507, 10)).rejects.toMatchObject({status: 409});
        await expect(BriefingService.copyNews(482, 507, 999, 30)).rejects.toMatchObject({status: 404});
        await expect(BriefingService.copyNews(482, 507, 508, 999)).rejects.toMatchObject({status: 404});
        // another briefing of the same profile, a briefing that is too old, a profile of another language
        ofUser.mockImplementation(async (userId, id) => ({507: here, 508: {...there, id_profile: 3}, 510: {...there, id: 510, created_at: new Date(Date.now() - 8 * 24 * 3600e3)}, 509: {...there, id: 509, id_profile: 5}}[id] ?? null));
        await expect(BriefingService.copyNews(482, 507, 508, 30)).rejects.toMatchObject({status: 409});
        await expect(BriefingService.copyNews(482, 507, 510, 30)).rejects.toMatchObject({status: 409});
        await expect(BriefingService.copyNews(482, 507, 509, 30)).rejects.toMatchObject({status: 409});
        expect(addItem).not.toHaveBeenCalled();
    });
});

describe('BriefingService.copyNews, the card of this briefing that tells the same news', () => {
    it('should say which card tells the same news, when one of its articles is on a card of this briefing, or a card of it is a version of it', async () => {
        // an article in common with the second card of this briefing (the 20, the second in its order)
        ofUser.mockImplementation(async (userId, id) => ({507: {...here, items: [card(10, 'lesoir.be'), card(20, 'bbc.co.uk', {articles: [{url: 'https://hln.be/b'}], titleTranslation: 'La nouvelle'})]}, 508: there}[id] ?? null));
        const answer = await BriefingService.copyNews(482, 507, 508, 30);
        expect(answer.similar).toEqual({storyId: 20, number: 2, title: 'La nouvelle', source: 'bbc.co.uk'});
        // the story of the card copied is the one of the card 10: a version of it
        const {similar} = await BriefingService.copyNews(482, 507, 508, 10);
        expect(similar).toMatchObject({storyId: 10, number: 1});
    });

    it('should say none when no card of this briefing tells the same news', async () => {
        expect((await BriefingService.copyNews(482, 507, 508, 30)).similar).toBeNull();
    });
});

describe('BriefingService.foldNews', () => {
    const items = [card(10, 'lesoir.be', {corroboration: {media: 2, mediaNames: ['lesoir.be', 'rtbf.be']}}), card(20, 'bbc.co.uk'),
        card(-1, 'hln.be', {imported: true, transferred: true, corroboration: {media: 1, mediaNames: ['hln.be']}})];
    beforeEach(() => ofUser.mockImplementation(async () => ({...here, items})));

    it('should keep the card the reader chose with the other folded into it: among its angles, its articles and its media', async () => {
        const {item, at, removed} = await BriefingService.foldNews(482, 507, 10, -1);
        expect(foldItems).toHaveBeenCalledTimes(1);
        const [userId, briefingId, keep, drop, saved] = foldItems.mock.calls[0];
        expect([userId, briefingId, keep, drop]).toEqual([482, 507, 10, -1]);
        expect(saved.storyId).toBe(10);
        expect(saved.angles[0]).toMatchObject({storyId: -1, folded: true, source: 'hln.be'});
        expect(saved.articles.map(article => article.url)).toEqual(['https://lesoir.be/a', 'https://lesoir.be/b', 'https://hln.be/a', 'https://hln.be/b']);
        expect(saved.corroboration.mediaNames).toEqual(['lesoir.be', 'rtbf.be', 'hln.be']);
        // no negative id among the stories merged into it: only the stories of the database are
        expect(saved.mergedStoryIds).toEqual([]);
        expect(saved.joinedCards).toEqual([{storyId: -1, title: expect.any(String)}]);
        expect([item.storyId, at, removed]).toEqual([10, 1, -1]);
    });

    it('should keep the card added, the card of the briefing going among its angles, the card added staying one of the added', async () => {
        const {item, removed} = await BriefingService.foldNews(482, 507, -1, 10);
        const saved = foldItems.mock.calls[0][4];
        expect(saved).toMatchObject({storyId: -1, imported: true, transferred: true});
        expect(saved.angles[0]).toMatchObject({storyId: 10, folded: true});
        expect(saved.mergedStoryIds).toEqual([10]);
        expect([item.storyId, removed]).toEqual([-1, 10]);
    });

    it('should refuse ids that are none or the same, and a card that is not there, and say when the briefing changed meanwhile', async () => {
        for (const [keep, drop] of [['x', 10], [10, 'y'], [0, 10], [10, 10], [10, null]]) {
            await expect(BriefingService.foldNews(482, 507, keep, drop)).rejects.toMatchObject({status: 400});
        }
        await expect(BriefingService.foldNews(482, 507, 10, 99)).rejects.toMatchObject({status: 404});
        await expect(BriefingService.foldNews(482, 507, 99, 10)).rejects.toMatchObject({status: 404});
        foldItems.mockResolvedValue(null);
        await expect(BriefingService.foldNews(482, 507, 10, -1)).rejects.toMatchObject({status: 404});
    });
});
