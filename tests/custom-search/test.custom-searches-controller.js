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
            mockReq = { query: { userId: '1' } };
            const mockData = [{ id: 1, name: 'Search1' }];

            CustomSearchService.getUserCustomSearch.mockResolvedValue(mockData);

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(CustomSearchService.getUserCustomSearch).toHaveBeenCalledWith(mockReq.query);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(mockData);
        });

        it('should return 400 if service throws a "not found" string error', async () => {
            mockReq = { query: { userId: '99' } };
            const errorMsg = "None of theses custom searches were found: ...";

            CustomSearchService.getUserCustomSearch.mockRejectedValue(errorMsg);

            await CustomSearchController.getUserCustomSearch(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: errorMsg });
        });
    });
});