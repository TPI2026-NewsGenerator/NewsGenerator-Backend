//
//  Author: Fabian Rostello
//  Date: 12.10.2026
//  File: test.write-steps.js
//  Description: The steps of a briefing written: saved on its row, but not for a briefing of the
//               benches, written without saving it (no id)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const profileModel = await import('../../models/profile-model.js');
jest.unstable_mockModule('../../models/profile-model.js', () => ({...profileModel, ProfileModel: {
    ...profileModel.ProfileModel,
    get: jest.fn(async () => ({id: 1})),
    briefingInterests: jest.fn(async () => [{id: 1, text: 'Swiss politics', project: null}]),
    projects: jest.fn(async () => []),
}}));
const briefingModel = await import('../../models/briefing-model.js');
jest.unstable_mockModule('../../models/briefing-model.js', () => ({...briefingModel, BriefingModel: {...briefingModel.BriefingModel, step: jest.fn(async () => {})}}));
const discovery = await import('../../services/discovery-service.js');
jest.unstable_mockModule('../../services/discovery-service.js', () => ({...discovery, DiscoveryService: {...discovery.DiscoveryService, prune: jest.fn(async () => {})}}));
// the briefing is stopped right after its first step: the rest needs the database
const feedback = await import('../../services/feedback-service.js');
jest.unstable_mockModule('../../services/feedback-service.js', () => ({...feedback, FeedbackService: {...feedback.FeedbackService, of: jest.fn(async () => { throw new Error('stopped'); })}}));

const {write} = await import('../../services/briefing-service.js');
const {BriefingModel} = await import('../../models/briefing-model.js');

beforeEach(() => BriefingModel.step.mockClear());

describe('write', () => {
    it('should save its step on the row of a saved briefing', async () => {
        await expect(write(7, 1, 24, 10)).rejects.toThrow('stopped');
        expect(BriefingModel.step).toHaveBeenCalledWith(7, 'ranking');
    });

    it('should not save its steps when written by the benches, without an id', async () => {
        await expect(write(null, 1, 24, 10)).rejects.toThrow('stopped');
        expect(BriefingModel.step).not.toHaveBeenCalled();
    });
});
