//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.organization-items.js
//  Description: The item of Wikidata an organisation is: the one called so when it is the only one, else
//               the one the AI chooses from the titles of its news, in 10 Wikipedias at least
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const namedItems = jest.fn();
const describeItems = jest.fn();
const ollamaJson = jest.fn();
const titlesNaming = jest.fn(async () => ['Woltemade mit Juventus gegen Lazio', 'Juventus, Tudor: "Siamo in crescita"']);
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, namedItems, describeItems}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {titlesNaming}}));
const {organizationItem, organizationPrompt} = await import('../../services/utils/organization-items.js');

const row = {id: 7, name: 'Juventus', lang: 'it'};
const JUVENTUS = [
    {qid: 'Q1422', label: 'Juventus FC', description: 'association football club in Turin, Italy', links: 133, human: false},
    {qid: 'Q63180', label: 'Kamil Glik', description: 'Polish association football player', links: 40, human: true},
    {qid: 'Q1138834', label: 'Juventus', description: 'Lithuanian basketball team', links: 15, human: false},
];

beforeEach(() => {
    namedItems.mockReset();
    describeItems.mockReset();
    ollamaJson.mockReset();
    titlesNaming.mockClear();
});

describe('organizationItem', () => {
    it('should take the one item called so without asking the AI', async () => {
        namedItems.mockResolvedValueOnce([{qid: 'Q130879', exact: true}, {qid: 'Q9', exact: false}]);
        expect(await organizationItem({id: 1, name: 'Reuters', lang: 'en'})).toBe('Q130879');
        expect(describeItems).not.toHaveBeenCalled();
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should let the AI choose among the items called so or starting so, no person among them', async () => {
        namedItems.mockResolvedValueOnce([{qid: 'Q1422', exact: false}, {qid: 'Q63180', exact: true}, {qid: 'Q1138834', exact: true}]);
        describeItems.mockResolvedValueOnce(JUVENTUS);
        ollamaJson.mockResolvedValueOnce({n: 1});
        expect(await organizationItem(row)).toBe('Q1422');
        expect(namedItems).toHaveBeenCalledWith('Juventus', 'it');
        expect(titlesNaming).toHaveBeenCalledWith(7, 5);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('[1] Juventus FC: association football club in Turin, Italy (133 Wikipedias)');
        expect(prompt).toContain('[2] Juventus: Lithuanian basketball team (15 Wikipedias)');
        expect(prompt).not.toContain('Kamil Glik');
        expect(prompt).toContain('- Woltemade mit Juventus gegen Lazio');
    });

    it('should take none when the AI cannot tell, chooses an item in few Wikipedias, or there is nothing to choose', async () => {
        namedItems.mockResolvedValue([{qid: 'Q1422', exact: false}, {qid: 'Q1138834', exact: false}]);
        describeItems.mockResolvedValue([JUVENTUS[0], {...JUVENTUS[2], links: 6}]);
        ollamaJson.mockResolvedValueOnce({n: 0}).mockResolvedValueOnce({n: 2}).mockResolvedValueOnce({n: 9}).mockResolvedValueOnce(null);
        for (let i = 0; i < 4; i++) expect(await organizationItem(row)).toBeNull();

        ollamaJson.mockClear();
        namedItems.mockResolvedValueOnce([]);
        expect(await organizationItem(row)).toBeNull();
        titlesNaming.mockResolvedValueOnce([]);
        expect(await organizationItem(row)).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should tell the AI a part of many names is none of them', () => {
        expect(organizationPrompt('FC', ['1860 gegen Bayern II'], [JUVENTUS[0]])).toContain('only a part of many names ("FC", "Club", "United")');
    });
});

describe('namedItems', () => {
    it('should keep the items called so or whose name starts so, in the order found, no page of a family name', async () => {
        jest.restoreAllMocks();
        const {namedItems: real} = wikidata;
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ok: true, status: 200, headers: new Headers(), json: async () => ({search: [
            {id: 'Q24826', label: 'Liverpool', match: {text: 'Liverpool'}},
            {id: 'Q1130849', label: 'Liverpool F.C.', match: {text: 'Liverpool F.C.'}},
            {id: 'Q37502389', label: 'Liverpool', description: 'family name', match: {text: 'Liverpool'}},
            {id: 'Q99', label: 'Port of Liverpool', match: {text: 'Port of Liverpool'}},
            {id: 'Q100', label: 'Liverpoolian', match: {text: 'Liverpoolian'}},
        ]})});
        expect(await real('Liverpool', 'en')).toEqual([{qid: 'Q24826', exact: true}, {qid: 'Q1130849', exact: false}]);
        fetch.mockRestore();
    });
});
