//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: test.profile-interests.js
//  Description: An interest of the profile changed or deleted by the reader (PATCH and DELETE
//               /profile/interests/:id): only one of the profile itself, never one of its projects
//

import {describe, expect, it, jest} from '@jest/globals';

const prisma = {
    profile_interests: {updateMany: jest.fn(async () => ({count: 1})), deleteMany: jest.fn(async () => ({count: 0}))},
    $executeRawUnsafe: jest.fn(async () => 1),
};
jest.unstable_mockModule('../../config/db.js', () => ({prisma}));
const {ProfileModel} = await import('../../models/profile-model.js');

describe('the interests of a profile changed by the reader', () => {
    it('should change only an interest of the profile itself, its vectors too', async () => {
        await ProfileModel.updateInterest(3, 12, {text: 'La voile', dense: '[0.1]', sparse: '{1:0.5}/250002'});

        expect(prisma.profile_interests.updateMany).toHaveBeenCalledWith({where: {id: 12, id_profile: 3, id_project: null}, data: {text: 'La voile'}});
        expect(prisma.$executeRawUnsafe.mock.calls[0][0]).toContain('id_project IS NULL');
    });

    it('should delete only an interest of the profile itself', async () => {
        expect(await ProfileModel.deleteInterest(3, 12)).toBe(0);
        expect(prisma.profile_interests.deleteMany).toHaveBeenCalledWith({where: {id: 12, id_profile: 3, id_project: null}});
    });
});
