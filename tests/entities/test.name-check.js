//
//  Author: Fabian Rostello
//  Date: 21.10.2026
//  File: test.name-check.js
//  Description: The names of a card checked against its titles: asked to the AI for the items in few
//               Wikipedias only, the link of a name the AI says is another thing left out, whatever fails
//               leaving the name as it was
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const describeItems = jest.fn();
const countriesOfItems = jest.fn(async () => new Map());
const ollamaJson = jest.fn();
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, describeItems}));
jest.unstable_mockModule('../../services/utils/countries.js', () => ({countriesOfItems}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {CHECK_MAX_LINKS, checkPrompt, countriesOfSites, withNamesChecked} = await import('../../services/utils/name-check.js');

const cards = [{storyId: 1, titles: ['Hernández Hernández, árbitro de Primera división: "El arbitraje es aprender a resetear"']}];
const MALTA = {qid: 'Q58305', label: 'Maltese First Division', description: 'sports league', links: 14, human: false};
const UEFA = {qid: 'Q35572', label: 'UEFA', description: 'governing body', links: 127, human: false};
const read = () => [{storyId: 1, names: [{name: 'Primera División', qid: 'Q58305', kind: 'organization'}, {name: 'UEFA', qid: 'Q35572', kind: 'organization'},
    {name: 'Hernandez Hernandez', qid: null, kind: 'person'}], places: [{name: 'Malta', qid: 'Q233', kind: 'location'}]}];

beforeEach(() => {
    describeItems.mockReset();
    ollamaJson.mockReset();
    countriesOfItems.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('withNamesChecked', () => {
    it('should leave the link of a name the AI says is another thing, and ask only for items in few Wikipedias', async () => {
        describeItems.mockImplementation(async (qids) => [MALTA, UEFA, {qid: 'Q233', label: 'Malta', description: 'country', links: 300, human: false}]
            .filter(item => qids.includes(item.qid)));
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        const [card] = await withNamesChecked(read(), cards);
        expect(card.names.map(name => name.qid)).toEqual([null, 'Q35572', null]);
        // UEFA (127) and Malta (300) are above the limit: one call
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('"Primera División" (organization)');
        expect(prompt).toContain('Maltese First Division: sports league (14 Wikipedias');
        expect(prompt).toContain('- Hernández Hernández, árbitro de Primera división');
        expect(CHECK_MAX_LINKS).toBe(60);
    });

    it('should keep the link when the AI says yes or unsure, answers badly or fails', async () => {
        describeItems.mockResolvedValue([MALTA]);
        const rows = () => [{storyId: 1, names: [{name: 'Primera División', qid: 'Q58305', kind: 'organization'}], places: []}];
        for (const answer of [{same: 'yes'}, {same: 'unsure'}, {same: 'maybe'}, null]) {
            ollamaJson.mockResolvedValueOnce(answer);
            expect((await withNamesChecked(rows(), cards))[0].names[0].qid).toBe('Q58305');
        }
        ollamaJson.mockRejectedValueOnce(new Error('no answer'));
        expect((await withNamesChecked(rows(), cards))[0].names[0].qid).toBe('Q58305');
    });

    it('should leave the names as they are when Wikidata cannot describe the items, and when the card has no title', async () => {
        describeItems.mockRejectedValue(new Error('Wikidata asked to wait.'));
        const [card] = await withNamesChecked([{storyId: 2, names: [{name: 'X', qid: 'Q1', kind: 'organization'}], places: []}], [{storyId: 2, titles: ['t']}]);
        expect(card.names[0].qid).toBe('Q1');
        expect(ollamaJson).not.toHaveBeenCalled();
        describeItems.mockReset();
        await withNamesChecked([{storyId: 3, names: [{name: 'X', qid: 'Q1', kind: 'organization'}], places: []}], [{storyId: 3, titles: []}]);
        expect(describeItems).not.toHaveBeenCalled();
    });

    it('should drop a place the AI says is another thing from the places of the card', async () => {
        describeItems.mockResolvedValue([{qid: 'Q9', label: 'Dmbx1', description: 'gene', links: 0, human: false}]);
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        const [card] = await withNamesChecked([{storyId: 1, names: [], places: [{name: 'CDMX', qid: 'Q9', kind: 'location'}]}], cards);
        expect(card.places).toEqual([]);
    });

    it('should tell the AI the countries of the sites of the card by their names', async () => {
        expect(countriesOfSites(['2424.mg', 'newsmada.com', 'lemonde.fr', 'newsmada.mg'])).toBe('Madagascar (2), France (1)');
        expect(countriesOfSites([])).toBe('');
        describeItems.mockResolvedValue([MALTA]);
        ollamaJson.mockResolvedValueOnce({same: 'yes'});
        await withNamesChecked(read().map(card => ({...card, names: [card.names[0]], places: []})), [{...cards[0], sites: ['marca.com', 'as.es']}]);
        expect(ollamaJson.mock.calls[0][0]).toContain('Countries of the sites that published them: Spain (1)');
    });

    it('should write the prompt with the country of the item when it has one', () => {
        expect(checkPrompt({name: 'OL', kind: 'organization', titles: ['t'], label: 'Open Library', description: 'online project', links: 41, country: 'US'}))
            .toContain('Open Library: online project (41 Wikipedias, country United States)');
    });
});
