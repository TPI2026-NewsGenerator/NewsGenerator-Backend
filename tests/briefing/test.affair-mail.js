//
//  Author: Fabian Rostello
//  Date: 05.11.2026
//  File: test.affair-mail.js
//  Description: The affair of a card for the e-mail: its view and the size of its thread, nothing when the card is no affair
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const threadStats = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/affair-model.js', () => ({AffairModel: {threadStats}}));
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {}}));
jest.unstable_mockModule('../../services/briefing-service.js', () => ({feedsOf: jest.fn()}));
jest.unstable_mockModule('../../services/push-service.js', () => ({PushService: {}}));
jest.unstable_mockModule('../../services/utils/affair.js', () => ({affairFile: jest.fn(), buildAffair: jest.fn(), translateEvents: jest.fn()}));
jest.unstable_mockModule('../../services/utils/affair-watch.js', () => ({watchAffair: jest.fn()}));
const {AffairService} = await import('../../services/affair-service.js');

const VIEW = {affair: true, storyId: 5, title: 'The FIFA files', about: 'a', events: [{id: 1, at: '2026-10-07T10:00:00.000Z', kind: 'key', title: 'An event'}],
    coverage: {media: 10, news: 20, languages: []}, builtAt: '2026-11-05T10:00:00.000Z'};

describe('AffairService.forMail', () => {
    beforeEach(() => {
        threadStats.mockReset().mockResolvedValue([{id: 5, stories: 15, media: 129}]);
        jest.spyOn(AffairService, 'view').mockReset().mockResolvedValue(VIEW);
    });

    it('should give the title, the events, the coverage and the size of the thread of the card', async () => {
        expect(await AffairService.forMail(4, 7, '5')).toEqual({title: 'The FIFA files', events: VIEW.events, coverage: VIEW.coverage, chip: {stories: 15, media: 129}});
        expect(AffairService.view).toHaveBeenCalledWith(4, 7, '5');
        expect(threadStats).toHaveBeenCalledWith([5]);
    });

    it('should give no thread when the database does not tell, and nothing when the card is no affair', async () => {
        threadStats.mockRejectedValueOnce(new Error('database down'));
        expect((await AffairService.forMail(4, 7, 5)).chip).toBeNull();
        threadStats.mockResolvedValueOnce([]);
        expect((await AffairService.forMail(4, 7, 5)).chip).toBeNull();
        AffairService.view.mockResolvedValue({affair: false});
        expect(await AffairService.forMail(4, 7, 5)).toBeNull();
    });

    it('should let the failure of the build through: the e-mail leaves the affair out (see withAffairs)', async () => {
        AffairService.view.mockRejectedValue(new Error('the AI is down'));
        await expect(AffairService.forMail(4, 7, 5)).rejects.toThrow('the AI is down');
    });
});
