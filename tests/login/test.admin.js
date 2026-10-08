//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.admin.js
//  Description: The e-mail of the briefing and several profiles are for the administrators, their
//               role read in the database at each request
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const roleName = jest.fn();
const count = jest.fn(async () => 1);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {roleName}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {count}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {}}));
jest.unstable_mockModule('../../services/feed-service.js', () => ({FeedService: {}}));
jest.unstable_mockModule('../../services/discovery-service.js', () => ({DiscoveryService: {}, JUDGE_THRESHOLD: 0.45, RELEVANCE_DAYS: 14}));
jest.unstable_mockModule('../../services/feedback-service.js', () => ({FeedbackService: {}}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({searchesOfUser: async () => []}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({embed: jest.fn(), toSparsevec: jest.fn(), toVector: jest.fn()}));
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({interestsOf: jest.fn()}));

const {adminOnly, isAdmin} = await import('../../services/utils/admin.js');
const {ProfileService} = await import('../../services/profile-service.js');

const response = () => {
    const res = {status: jest.fn(() => res), json: jest.fn()};
    return res;
};

beforeEach(() => {
    roleName.mockReset();
    count.mockClear();
});

describe('adminOnly', () => {
    it('should let an administrator through, and refuse a reader with what is refused', async () => {
        const next = jest.fn();
        roleName.mockResolvedValueOnce('Admin');
        await adminOnly('Refused.')({user: {id: 4}}, response(), next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(roleName).toHaveBeenCalledWith(4);

        roleName.mockResolvedValueOnce('User');
        const res = response();
        await adminOnly('Refused.')({user: {id: 311}}, res, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({error: 'Refused.'});
    });

    it('should not call an account gone an administrator', async () => {
        roleName.mockResolvedValueOnce(null);
        expect(await isAdmin(999)).toBe(false);
    });
});

describe('ProfileService.create', () => {
    it('should refuse another profile to a reader who is not an administrator, before writing anything', async () => {
        roleName.mockResolvedValue('User');
        await expect(ProfileService.create(311, {name: 'Second', text: 'Le tennis', language: 'fr'})).rejects.toMatchObject({status: 403});
        expect(count).not.toHaveBeenCalled();
    });
});
