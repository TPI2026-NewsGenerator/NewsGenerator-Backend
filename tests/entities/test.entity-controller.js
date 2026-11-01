//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.entity-controller.js
//  Description: The answer of a failed call carries how long to wait when Wikidata asked for it, for a
//               client that carries on by itself
//

import {describe, expect, it, jest} from '@jest/globals';

const checkNames = jest.fn();
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {checkNames}}));
const {EntityController} = await import('../../controllers/entity-controller.js');

const answered = async (work) => {
    checkNames.mockImplementation(work);
    const res = {status: jest.fn().mockReturnThis(), json: jest.fn()};
    await EntityController.importCheck({profileId: 1, body: {names: ['A name']}}, res);
    return res;
};

describe('EntityController failed answers', () => {
    it('should tell how long to wait when Wikidata asked for it', async () => {
        const res = await answered(async () => { throw Object.assign(new Error('Wikidata could not be searched'), {status: 502, retryIn: 30000}); });
        expect(res.status).toHaveBeenCalledWith(502);
        expect(res.json).toHaveBeenCalledWith({error: 'Wikidata could not be searched', retryIn: 30000});
    });

    it('should tell the error alone otherwise, and the data of a call that went well', async () => {
        const failed = await answered(async () => { throw Object.assign(new Error('names: 1 to 10 names.'), {status: 400}); });
        expect(failed.json).toHaveBeenCalledWith({error: 'names: 1 to 10 names.'});

        const well = await answered(async () => ({results: [{name: 'A name', status: 'word'}]}));
        expect(well.status).toHaveBeenCalledWith(200);
        expect(well.json).toHaveBeenCalledWith({results: [{name: 'A name', status: 'word'}]});
    });
});
