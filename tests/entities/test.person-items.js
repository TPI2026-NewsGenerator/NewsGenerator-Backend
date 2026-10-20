//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: test.person-items.js
//  Description: Whether a person is the one item of Wikidata called so: a human in a Wikipedia at least,
//               else when the AI finds the titles of their news fit it; never an item that is no human
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const describeItems = jest.fn();
const readCountries = jest.fn(async (qids) => new Map(qids.map(qid => [qid, {country: 'MX', international: false, bodies: []}])));
const ollamaJson = jest.fn();
const titlesNaming = jest.fn(async () => ['Uruguay fracasa en su innovación de las tarjetas virtuales']);
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, describeItems, readCountries}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {titlesNaming}}));
const {familyName, personItem} = await import('../../services/utils/person-items.js');

const VARELA = {qid: 'Q16238998', label: 'Eduardo Varela', description: 'Mexican journalist', links: 0, human: true};

beforeEach(() => {
    describeItems.mockReset();
    ollamaJson.mockReset();
    titlesNaming.mockClear();
    readCountries.mockClear();
});

describe('personItem', () => {
    it('should keep a human in a Wikipedia at least without asking the AI', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q130394830', description: 'American football player', links: 1, human: true}]);
        expect(await personItem({id: 1, name: 'Keelon Russell'}, 'Q130394830')).toBe('Q130394830');
        expect(describeItems).toHaveBeenCalledWith(['Q130394830']);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should never take an item that is no human: "one person", a song called Kim Jong Un', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q131541644', description: '2017 song by Lacrim', links: 0, human: false}])
            .mockResolvedValueOnce([]);
        expect(await personItem({id: 2, name: 'Kim Jong Un'}, 'Q131541644')).toBeNull();
        expect(await personItem({id: 3, name: 'one person'}, 'Q140403752')).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should ask the AI for an item in no Wikipedia, and keep it only when it says yes', async () => {
        describeItems.mockResolvedValue([VARELA]);
        ollamaJson.mockResolvedValueOnce({same: 'no'}).mockResolvedValueOnce({same: 'unsure'}).mockResolvedValueOnce({same: 'yes'});
        const row = {id: 4, name: 'Eduardo Varela', lang: 'es'};
        expect(await personItem(row, 'Q16238998')).toBeNull();
        expect(await personItem(row, 'Q16238998')).toBeNull();
        expect(await personItem(row, 'Q16238998')).toBe('Q16238998');
        expect(titlesNaming).toHaveBeenCalledWith(4, 5);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('A person named in the news: "Eduardo Varela"');
        expect(prompt).toContain('- Uruguay fracasa en su innovación de las tarjetas virtuales');
        expect(prompt).toContain('The only item of Wikidata called so: Mexican journalist (country: MX), in 0 Wikipedias.');
    });

    it('should ask the AI for a family name after a particle, not for one known in 10 Wikipedias', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q13363720', description: 'botanist (1928-2011)', links: 1, human: true}])
            .mockResolvedValueOnce([{qid: 'Q357984', description: 'Belgian association football player', links: 93, human: true}]);
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        expect(await personItem({id: 5, name: 'De Roon'}, 'Q13363720')).toBeNull();
        expect(await personItem({id: 6, name: 'De Bruyne'}, 'Q357984')).toBe('Q357984');
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should take none without asking when no news title is left', async () => {
        describeItems.mockResolvedValueOnce([VARELA]);
        titlesNaming.mockResolvedValueOnce([]);
        expect(await personItem({id: 7, name: 'Eduardo Varela'}, 'Q16238998')).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });
});

describe('familyName', () => {
    it('should tell a family name after a particle from a full name', () => {
        expect(familyName('De Roon')).toBe(true);
        expect(familyName('van Bommel')).toBe(true);
        expect(familyName('Di Battista')).toBe(true);
        expect(familyName('Kevin De Bruyne')).toBe(false);
        expect(familyName('Eduardo Varela')).toBe(false);
        expect(familyName('Infantino')).toBe(false);
    });
});
