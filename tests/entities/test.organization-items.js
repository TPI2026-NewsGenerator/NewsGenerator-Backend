//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.organization-items.js
//  Description: The item of Wikidata an organisation is: the one called so when it is the only one and
//               may be a body (no human, place nor work, in 2 Wikipedias), else the one the AI chooses from
//               the titles of its news, in 10 Wikipedias at least (1 when it was the only one called so)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const namedItems = jest.fn();
const describeItems = jest.fn();
const ollamaJson = jest.fn();
const sitesNaming = jest.fn(async () => []);
const countriesOfItems = jest.fn(async () => new Map());
const titlesNaming = jest.fn(async () => ['Woltemade mit Juventus gegen Lazio', 'Juventus, Tudor: "Siamo in crescita"']);
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, namedItems, describeItems}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {titlesNaming, sitesNaming}}));
jest.unstable_mockModule('../../services/utils/countries.js', () => ({countriesOfItems}));
const {LONE_SITELINKS, organizationItem, organizationPrompt} = await import('../../services/utils/organization-items.js');

const row = {id: 7, name: 'Juventus', lang: 'it'};
const JUVENTUS = [
    {qid: 'Q1422', label: 'Juventus FC', description: 'association football club in Turin, Italy', links: 133, human: false, place: false, work: false},
    {qid: 'Q63180', label: 'Kamil Glik', description: 'Polish association football player', links: 40, human: true, place: false, work: false},
    {qid: 'Q1138834', label: 'Juventus', description: 'Lithuanian basketball team', links: 15, human: false, place: false, work: false},
];
const HAZM = {id: 9, name: 'Al-Hazm', lang: 'es'};
const SETTLEMENT = {qid: 'Q26201058', label: 'Al-Hazm', description: 'human settlement in Oman', links: 2, human: false, place: true, work: false};
const CLUB = {qid: 'Q2499905', label: 'Al Hazem SC', description: 'association football club in Saudi Arabia', links: 27, human: false, place: false, work: false};

beforeEach(() => {
    namedItems.mockReset();
    describeItems.mockReset();
    ollamaJson.mockReset();
    titlesNaming.mockClear();
    sitesNaming.mockReset();
    sitesNaming.mockResolvedValue([]);
    countriesOfItems.mockReset();
    countriesOfItems.mockResolvedValue(new Map());
});

describe('organizationItem', () => {
    it('should take the one item called so without asking the AI when it may be a body', async () => {
        namedItems.mockResolvedValueOnce([{qid: 'Q130879', exact: true}, {qid: 'Q9', exact: false}]);
        describeItems.mockResolvedValueOnce([
            {qid: 'Q130879', label: 'Reuters', description: 'news agency', links: 60, human: false, place: false, work: false},
            {qid: 'Q9', label: 'Reuters Group', description: 'company', links: 20, human: false, place: false, work: false},
        ]);
        expect(await organizationItem({id: 1, name: 'Reuters', lang: 'en'})).toBe('Q130879');
        expect(describeItems).toHaveBeenCalledWith(['Q130879', 'Q9']);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should ask the AI when the sites naming the one item called so are of another country than the item', async () => {
        const OPEN_LIBRARY = {qid: 'Q1201876', label: 'Open Library', description: 'online project for book data', links: 41, human: false, place: false, work: false};
        namedItems.mockResolvedValue([{qid: 'Q1201876', exact: true}]);
        describeItems.mockResolvedValue([OPEN_LIBRARY]);
        countriesOfItems.mockResolvedValue(new Map([['Q1201876', {country: 'US', international: false}]]));
        sitesNaming.mockResolvedValue([{site: 'lequipe.fr', news: 80}, {site: 'olympiquelyonnais.fr', news: 20}, {site: 'archive.org', news: 5}]);
        ollamaJson.mockResolvedValueOnce({n: 0});
        expect(await organizationItem({id: 11, name: 'OL', lang: 'fr'})).toBeNull();
        expect(ollamaJson).toHaveBeenCalledTimes(1);

        // the AI agrees with the item: kept
        ollamaJson.mockResolvedValueOnce({n: 1});
        expect(await organizationItem({id: 11, name: 'OL', lang: 'fr'})).toBe('Q1201876');
    });

    it('should not ask the AI for an item of the country of its sites, of the United States, an international body, or too few news', async () => {
        const ITEM = {qid: 'Q5', label: 'Shopee', description: 'e-commerce company', links: 21, human: false, place: false, work: false};
        namedItems.mockResolvedValue([{qid: 'Q5', exact: true}]);
        describeItems.mockResolvedValue([ITEM]);
        const cases = [
            [{country: 'SG', international: false}, [{site: 'shopee.sg', news: 30}, {site: 'lemonde.fr', news: 10}]],
            // no site of the United States has a domain of its own
            [{country: 'US', international: false}, [{site: 'lemonde.fr', news: 25}, {site: 'elpais.es', news: 15}]],
            [{country: 'CH', international: true}, [{site: 'lemonde.fr', news: 40}]],
            [{country: 'SG', international: false}, [{site: 'lemonde.fr', news: 19}]],
            [{country: null, international: false}, [{site: 'lemonde.fr', news: 40}]],
        ];
        for (const [country, sites] of cases) {
            countriesOfItems.mockResolvedValue(new Map([['Q5', country]]));
            sitesNaming.mockResolvedValue(sites);
            expect(await organizationItem({id: 12, name: 'Shopee', lang: 'en'})).toBe('Q5');
        }
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should ask the AI when the one item called so is a place, a human, a work or in too few Wikipedias', async () => {
        namedItems.mockResolvedValue([{qid: 'Q2499905', exact: false}, {qid: 'Q26201058', exact: true}]);
        describeItems.mockResolvedValueOnce([CLUB, SETTLEMENT]);
        ollamaJson.mockResolvedValueOnce({n: 1});
        expect(await organizationItem(HAZM)).toBe('Q2499905');
        expect(ollamaJson.mock.calls[0][0]).toContain('[2] Al-Hazm: human settlement in Oman (2 Wikipedias)');

        for (const lone of [{...SETTLEMENT, place: false, human: true}, {...SETTLEMENT, place: false, work: true},
            {...SETTLEMENT, place: false, links: LONE_SITELINKS - 1}]) {
            describeItems.mockResolvedValueOnce([CLUB, lone]);
            ollamaJson.mockResolvedValueOnce({n: 0});
            expect(await organizationItem(HAZM)).toBeNull();
        }
        expect(ollamaJson).toHaveBeenCalledTimes(4);
        // a human is never chosen: left out of the items asked
        expect(ollamaJson.mock.calls[1][0]).not.toContain('[2]');
    });

    it('should keep the item the AI chooses from 1 Wikipedia when one only was called so', async () => {
        namedItems.mockResolvedValue([{qid: 'Q5', exact: true}]);
        describeItems.mockResolvedValueOnce([{qid: 'Q5', label: 'Shelly Group', description: '', links: 1, human: false, place: false, work: false}]);
        ollamaJson.mockResolvedValueOnce({n: 1});
        expect(await organizationItem({id: 3, name: 'Shelly Group', lang: 'de'})).toBe('Q5');
        describeItems.mockResolvedValueOnce([{qid: 'Q5', label: 'gut bacteria', description: '', links: 0, human: false, place: false, work: false}]);
        ollamaJson.mockResolvedValueOnce({n: 1});
        expect(await organizationItem({id: 3, name: 'gut bacteria', lang: 'en'})).toBeNull();
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
        // nothing found: Wikidata not asked any more
        expect(describeItems).toHaveBeenCalledTimes(4);
        titlesNaming.mockResolvedValueOnce([]);
        expect(await organizationItem(row)).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should tell the AI a part of many names is none of them', () => {
        expect(organizationPrompt('FC', ['1860 gegen Bayern II'], [JUVENTUS[0]])).toContain('only a part of many names ("FC", "Club", "United")');
    });
});

describe('describeItems', () => {
    it('should tell a human, a place (a population, a position and nothing of a body, a bare settlement; no country) and a work', async () => {
        jest.restoreAllMocks();
        const {describeItems: real} = wikidata;
        const KIND = {Q1: 'Q5', Q7: 'Q486972'};
        const claim = (id, property) => [{mainsnak: {datavalue: {value: property === 'P31' ? {id: KIND[id] ?? 'Q43229'} : 'x'}}}];
        const of = (id, properties) => ({id, labels: {en: {value: id}}, sitelinks: {enwiki: {}},
            claims: Object.fromEntries(properties.map(property => [property, claim(id, property)]))});
        const items = [of('Q1', ['P31']), of('Q2', ['P31', 'P625', 'P1082']), of('Q3', ['P31', 'P625']), of('Q4', ['P31', 'P625', 'P159']),
            of('Q5', ['P31', 'P625', 'P1082', 'P297']), of('Q6', ['P31', 'P577']), of('Q7', ['P31', 'P17', 'P131'])];
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ok: true, status: 200, headers: new Headers(),
            json: async () => ({entities: Object.fromEntries(items.map(item => [item.id, item]))})});
        const described = await real(items.map(item => item.id));
        expect(described.map(({qid, human, place, work}) => ({qid, human, place, work}))).toEqual([
            {qid: 'Q1', human: true, place: false, work: false},
            // a town, a heliport; a university (a seat) and a country are no places
            {qid: 'Q2', human: false, place: true, work: false},
            {qid: 'Q3', human: false, place: true, work: false},
            {qid: 'Q4', human: false, place: false, work: false},
            {qid: 'Q5', human: false, place: false, work: false},
            {qid: 'Q6', human: false, place: false, work: true},
            // a human settlement known by its country and district only (Al-Hazm, Oman)
            {qid: 'Q7', human: false, place: true, work: false},
        ]);
        expect(described[0].links).toBe(1);
        fetch.mockRestore();
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
