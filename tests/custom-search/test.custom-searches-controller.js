//
//  Author: Fabian Rostello
//  Date: 19.05.2026
//  File: test.custom-search-controller.js
//  Description: Tests for custom searches controller
//

import { jest } from '@jest/globals';


// aide IA: if I want to test this code "" what would be the best approach using jest ?
jest.unstable_mockModule('../../services/customsearch-service.js', () => ({
    CustomSearchService: {
        getUserCustomSearch: jest.fn(),
        postPutUserCustomSearch: jest.fn(),
        deleteUserCustomSearch: jest.fn()
    }
}));

const { CustomSearchController } = await import('../../controllers/customsearch-controller.js');
const { CustomSearchService } = await import('../../services/customsearch-service.js');

describe('CustomSearchController', () => {
    let mockRes;
    let mockReq;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRes = {
            status: jest.fn().mockReturnThis(), // permet de chainer .status().json()
            json: jest.fn().mockReturnThis()
        };
    });

    describe('getUserCustomSearch', () => {
        it('should return 200 and data on success', async () => {
            mockReq = { query: {}, user: { id: 1 } };
            const mockData = [{ id: 1, name: 'Search1' }];

            CustomSearchService.getUserCustomSearch.mockResolvedValue(mockData);

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.getUserCustomSearch).toHaveBeenCalledWith({ userId: 1 });
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(mockData);
        });

        it('should use the token user id and ignore the userId in the query', async () => {
            mockReq = { query: { userId: '2' }, user: { id: 1 } };
            CustomSearchService.getUserCustomSearch.mockResolvedValue([]);

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.getUserCustomSearch).toHaveBeenCalledWith({ userId: 1 });
        });

        it('should answer the status of the service, with its message', async () => {
            mockReq = { query: {}, user: { id: 99 } };
            CustomSearchService.getUserCustomSearch.mockRejectedValue(Object.assign(new Error('This user_id does not exist...'), {status: 404}));

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'This user_id does not exist...' });
        });

        it('should answer 500 with the message of an error without status', async () => {
            mockReq = { query: {}, user: { id: 1 } };
            CustomSearchService.getUserCustomSearch.mockRejectedValue(new Error('database down'));

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'database down' });
        });
    });

    describe('postUserCustomSearch', () => {
        const search = {title: 'My search', keyword: 'trump', language: 'en', category: ['world']};

        it('should save the search of the authenticated user', async () => {
            mockReq = { body: {...search}, user: {id: 4} };
            CustomSearchService.postPutUserCustomSearch.mockResolvedValue({id: 1});

            await CustomSearchController.postUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.postPutUserCustomSearch).toHaveBeenCalledWith({...search, id: undefined, userId: 4});
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        it('should ignore the userId of another user in the body', async () => {
            mockReq = { body: {...search, id: 7, userId: 99}, user: {id: 4} };
            CustomSearchService.postPutUserCustomSearch.mockResolvedValue({id: 7});

            await CustomSearchController.postUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.postPutUserCustomSearch).toHaveBeenCalledWith(
                expect.objectContaining({id: 7, userId: 4})
            );
        });

        it('should refuse a request without an authenticated user', async () => {
            mockReq = { body: {...search, userId: 4} };

            await expect(CustomSearchController.postUserCustomSearch(mockReq, mockRes))
                .rejects.toMatchObject({status: 400});
            expect(CustomSearchService.postPutUserCustomSearch).not.toHaveBeenCalled();
        });
    });

    describe('deleteUserCustomSearch', () => {
        it('should delete with the token user id, ignore the body userId and return a JSON body', async () => {
            mockReq = { body: {id: 7, userId: 99}, user: {id: 4} };
            CustomSearchService.deleteUserCustomSearch.mockResolvedValue(undefined);

            await CustomSearchController.deleteUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.deleteUserCustomSearch).toHaveBeenCalledWith({id: 7, userId: 4});
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({deleted: true});
        });

        it('should answer 404 for a search that is not the user\'s', async () => {
            mockReq = { body: {id: 7}, user: {id: 4} };
            CustomSearchService.deleteUserCustomSearch.mockRejectedValue(Object.assign(new Error('This custom search does not exist...'), {status: 404}));

            await CustomSearchController.deleteUserCustomSearch(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({error: 'This custom search does not exist...'});
        });
    });
});
