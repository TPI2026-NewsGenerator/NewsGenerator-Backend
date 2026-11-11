//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.write-ai-version.js
//  Description: The AI version of a card that has none, written when the reader asks for it: three briefings of the morning of 11.11.2026
//               had none for any card, the AI having failed while they were written. The page of the lead article is read again, the AI
//               writes from its sentences, the card keeps the answer; and why none was written is said
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const setAi = jest.fn(async () => 1);
const getProfile = jest.fn(async () => ({languages: ['en'], text: 'Football.'}));
const html = jest.fn();
const aiWaysOf = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, setAi}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: getProfile}}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: html, Pages: html}}));
jest.unstable_mockModule('../../services/utils/ai-ways.js', () => ({aiWaysOf, WRITE_MODEL: 'deepseek-v4-pro:0813'}));
const {BriefingService} = await import('../../services/briefing-service.js');

const page = {url: 'https://togofoot.tg/la-ftf', content: 'La FTF et la LPFT signent une convention.', blocks: [{kind: 'text', text: 'La FTF et la LPFT signent une convention.'}]};
const card = (storyId, changes = {}) => ({
    storyId, title: 'The FTF entrusts the controls to the LPFT', titleTranslation: null, language: 'fr', summary: 'La FTF et la LPFT signent une convention.', ai: null,
    lead: {title: 'La FTF confie les commandes à la LPFT', url: 'https://togofoot.tg/la-ftf', source: 'togofoot.tg', language: 'fr'}, articles: [],
    corroboration: {media: 1, read: 1, independent: 1, agencies: []}, ...changes,
});
const row = (items) => ({id: 7, status: 'ready', id_profile: 3, hours: 24, created_at: new Date('2026-11-11T07:00:00Z'), finished_at: new Date('2026-11-11T07:05:00Z'), items});
const WRITTEN = {points: ['The FTF and the LPFT signed a convention.'], summary: 'The FTF and the LPFT signed a convention.', model: 'deepseek-v4-pro:0813'};

beforeEach(() => {
    ofUser.mockReset().mockResolvedValue(row([card(1), card(2, {ai: {points: ['Already.'], summary: 'Already.', model: 'x'}})]));
    setAi.mockReset().mockResolvedValue(1);
    html.mockReset().mockResolvedValue([page]);
    aiWaysOf.mockReset().mockResolvedValue(WRITTEN);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('BriefingService.writeAiVersion', () => {
    it('should read the page of the lead article again, have the AI write from it in the language of the reader, and keep the answer in the card', async () => {
        const answer = await BriefingService.writeAiVersion(4, '7', 1);

        expect(answer).toEqual({ai: WRITTEN});
        expect(html).toHaveBeenCalledWith(['https://togofoot.tg/la-ftf']);
        // the title of the article as the medium wrote it, the page, and the reader's language (the profile's)
        expect(aiWaysOf).toHaveBeenCalledWith('La FTF confie les commandes à la LPFT', page, expect.objectContaining({language: 'en'}));
        expect(setAi).toHaveBeenCalledWith(4, 7, 1, WRITTEN);
    });

    it('should answer the version a card has already, and ask the AI for nothing', async () => {
        const answer = await BriefingService.writeAiVersion(4, 7, 2);

        expect(answer).toEqual({ai: {points: ['Already.'], summary: 'Already.', model: 'x'}});
        expect(html).not.toHaveBeenCalled();
        expect(aiWaysOf).not.toHaveBeenCalled();
        expect(setAi).not.toHaveBeenCalled();
    });

    it('should say the AI did not answer, and keep nothing', async () => {
        aiWaysOf.mockImplementation(async (title, given, {report}) => {
            report.failed = 4;
            return null;
        });

        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: null, reason: 'no-answer'});
        expect(setAi).not.toHaveBeenCalled();
    });

    it('should say what the AI wrote was refused for a figure the article does not give', async () => {
        aiWaysOf.mockImplementation(async (title, given, {report}) => {
            report.rejected = true;
            return null;
        });

        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: null, reason: 'unbacked'});
    });

    it('should say the article could not be read again, and not ask the AI', async () => {
        html.mockResolvedValue([]);
        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: null, reason: 'unreadable'});
        html.mockRejectedValue(new Error('refused'));
        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: null, reason: 'unreadable'});
        expect(aiWaysOf).not.toHaveBeenCalled();
    });

    it('should refuse a card that is not in the briefing, a briefing that is not a ready one of the reader, and a card with no article', async () => {
        await expect(BriefingService.writeAiVersion(4, 7, 99)).rejects.toMatchObject({status: 404});
        ofUser.mockResolvedValue({...row([card(1)]), status: 'running'});
        await expect(BriefingService.writeAiVersion(4, 7, 1)).rejects.toMatchObject({status: 404});
        ofUser.mockResolvedValue(null);
        await expect(BriefingService.writeAiVersion(4, 7, 1)).rejects.toMatchObject({status: 404});
        ofUser.mockResolvedValue(row([card(1, {lead: undefined, articles: []})]));
        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: null, reason: 'unreadable'});
        await expect(BriefingService.writeAiVersion(4, 7, 'x')).rejects.toMatchObject({status: 400});
    });

    it('should not tell the reader the version is written when the card was gone or got one meanwhile', async () => {
        setAi.mockResolvedValue(0);
        // another call wrote one first: the card has it, the reader gets the page again with it
        ofUser.mockResolvedValueOnce(row([card(1)])).mockResolvedValueOnce(row([card(1, {ai: WRITTEN})]));
        expect(await BriefingService.writeAiVersion(4, 7, 1)).toEqual({ai: WRITTEN});
        ofUser.mockResolvedValueOnce(row([card(1)])).mockResolvedValueOnce(row([]));
        await expect(BriefingService.writeAiVersion(4, 7, 1)).rejects.toMatchObject({status: 404});
    });
});
