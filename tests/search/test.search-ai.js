//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.search-ai.js
//  Description: Tests for the search by meaning: the AI says which of the closest news answer the
//               sentence and which are only close to it
//

import {describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {normalizeSorting, searchPrompt, sortByMeaning} = await import('../../services/utils/search-ai.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const candidates = [
    {id: '1', title: 'Le conseil vote la fermeture du pont', description: '<p>Le vote a eu lieu   mardi.</p>'},
    {id: '2', title: 'La mairie publie son budget', description: ''},
    {id: '3', title: 'Travaux sur la route du lac', description: null},
];

describe('normalizeSorting', () => {
    it('should keep the ids given, each once, an answer never again as related', () => {
        expect(normalizeSorting({answers: ['[1]', '9', 1], related: ['1', '3', 3]}, ['1', '2', '3']))
            .toEqual({answers: ['1'], related: ['3']});
    });

    it('should give empty lists for an answer without them', () => {
        expect(normalizeSorting({}, ['1'])).toEqual({answers: [], related: []});
        expect(normalizeSorting(null, ['1'])).toEqual({answers: [], related: []});
    });
});

describe('searchPrompt', () => {
    it('should give the sentence and every candidate with its id', () => {
        const prompt = searchPrompt('la fermeture du pont', candidates);
        expect(prompt).toContain('"""la fermeture du pont"""');
        expect(prompt).toContain('[2] La mairie publie son budget');
        expect(prompt).toContain('"answers"');
        expect(prompt).toContain('"related"');
    });
});

describe('sortByMeaning', () => {
    it('should send the start of the description as text and read the two lists', async () => {
        chat.mockReset().mockResolvedValueOnce(json({answers: ['1'], related: ['3']}));
        expect(await sortByMeaning('la fermeture du pont', candidates)).toEqual({answers: ['1'], related: ['3']});
        expect(chat.mock.calls[0][0].messages[0].content).toContain('[1] Le conseil vote la fermeture du pont — Le vote a eu lieu mardi.');
    });

    it('should ask once more when the AI does not answer in JSON', async () => {
        chat.mockReset()
            .mockResolvedValueOnce({message: {content: 'not json'}})
            .mockResolvedValueOnce(json({answers: ['2'], related: []}));
        expect(await sortByMeaning('le budget', candidates)).toEqual({answers: ['2'], related: []});
        expect(chat).toHaveBeenCalledTimes(2);
    });
});
