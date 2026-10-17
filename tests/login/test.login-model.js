//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: test.login-model.js
//  Description: The account a username signs in to, whatever its case
//

import {jest} from '@jest/globals';

const findMany = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {users: {findMany}}}));
const {LoginModel} = await import('../../models/login-model.js');

describe('LoginModel.getUserByUsername', () => {
    it('should find the account whatever the case of its username', async () => {
        findMany.mockResolvedValueOnce([{id: 1, username: 'fabian'}]);

        expect(await LoginModel.getUserByUsername('Fabian')).toEqual({id: 1, username: 'fabian'});
        expect(findMany).toHaveBeenCalledWith({where: {username: {equals: 'Fabian', mode: 'insensitive'}}});
    });

    it('should take the account of the exact name first, and answer null when there is none', async () => {
        findMany.mockResolvedValueOnce([{id: 1, username: 'fabian'}, {id: 2, username: 'Fabian'}]);
        expect(await LoginModel.getUserByUsername('Fabian')).toEqual({id: 2, username: 'Fabian'});

        findMany.mockResolvedValueOnce([]);
        expect(await LoginModel.getUserByUsername('nobody')).toBeNull();
    });
});
