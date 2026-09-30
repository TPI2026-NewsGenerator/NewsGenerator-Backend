//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.custom-searches-service.js
//  Description: A saved search of another user, or already deleted, is a 404 when it is replaced or
//               deleted, not an error of the server
//

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../models/customsearch-model.js', () => ({
    CustomSearchModel: {
        getUserCustomSearch: jest.fn(),
        postUserCustomSearch: jest.fn(),
        updateUserCustomSearch: jest.fn(),
        deleteUserCustomSearch: jest.fn(),
    }
}));

const { CustomSearchService } = await import('../../services/customsearch-service.js');
const { CustomSearchModel } = await import('../../models/customsearch-model.js');

// what Prisma throws when no row matches the where of an update or a delete
const noRow = () => Object.assign(new Error('An operation failed because it depends on one or more records that were required but not found.'), {code: 'P2025'});

describe('CustomSearchService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('should answer 404 when the search to delete is not the user\'s', async () => {
        CustomSearchModel.deleteUserCustomSearch.mockRejectedValue(noRow());

        await expect(CustomSearchService.deleteUserCustomSearch({id: '7', userId: 4}))
            .rejects.toMatchObject({status: 404});
        expect(CustomSearchModel.deleteUserCustomSearch).toHaveBeenCalledWith(7, 4);
    });

    it('should answer 404 when the search to replace is not the user\'s', async () => {
        CustomSearchModel.updateUserCustomSearch.mockRejectedValue(noRow());

        await expect(CustomSearchService.postPutUserCustomSearch({id: 7, userId: 4, title: 'Foot', keyword: 'goal', language: 'en', category: ['sport']}))
            .rejects.toMatchObject({status: 404});
    });

    it('should delete a search of the user', async () => {
        CustomSearchModel.deleteUserCustomSearch.mockResolvedValue([{count: 1}, {id: 7}]);

        await expect(CustomSearchService.deleteUserCustomSearch({id: 7, userId: 4})).resolves.toBeUndefined();
    });

    it('should let any other error through', async () => {
        CustomSearchModel.deleteUserCustomSearch.mockRejectedValue(new Error('database down'));

        await expect(CustomSearchService.deleteUserCustomSearch({id: 7, userId: 4}))
            .rejects.toThrow('database down');
    });
});
