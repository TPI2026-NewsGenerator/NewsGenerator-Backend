//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: test.ai-ways.js
//  Description: The AI version of a card's points and summary: its own model, no reasoning, never Gemini, and no
//               figure the article does not give
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

process.env.AISTUDIO_API_KEY = 'test-key';
const {aiWaysOf, WRITE_MODEL} = await import('../../services/utils/ai-ways.js');

const page = {content: '', blocks: [
    {kind: 'text', text: 'The SBB announced a strike of 24 hours on Monday across the whole network.'},
    {kind: 'text', text: 'About 1,200 trains will not run, the company said in a statement on Friday.'},
]};
const answer = (json) => ({message: {content: JSON.stringify(json)}, prompt_eval_count: 100, eval_count: 20});
// the points and the summary are asked together: each prompt gets its own answer
const answering = ({points, summary}) => chat.mockImplementation(async ({messages}) =>
    messages[0].content.startsWith('You write the key points') ? answer(points) : answer(summary));

beforeEach(() => {
    chat.mockReset();
    globalThis.fetch = jest.fn();
});

describe('the AI version of a card', () => {
    it('should be written by its own model without reasoning, in the language of the reader', async () => {
        answering({points: {points: [{text: 'Grève CFF de 24 heures lundi [1].', sentences: [1]}, {text: '1200 trains supprimés.', sentences: [2]}]},
            summary: {summary: 'Les CFF annoncent une grève de 24 heures lundi, 1 200 trains ne circuleront pas.', sentences: [1, 2]}});

        const ways = await aiWaysOf('SBB strike on Monday', page, {language: 'fr'});

        expect(ways).toEqual({points: ['Grève CFF de 24 heures lundi.', '1200 trains supprimés.'],
            summary: 'Les CFF annoncent une grève de 24 heures lundi, 1 200 trains ne circuleront pas.', model: WRITE_MODEL});
        for (const [request] of chat.mock.calls) {
            expect(request.model).toBe(WRITE_MODEL);
            expect(request.think).toBe(false);
            expect(request.messages[0].content).toContain('for a reader in French');
        }
    });

    it('should leave out a text with a figure the article does not give, and keep the other', async () => {
        answering({points: {points: [{text: 'A strike of 48 hours on Monday.'}]},
            summary: {summary: 'The SBB strike for 24 hours on Monday: 1,200 trains will not run.'}});

        const ways = await aiWaysOf('SBB strike on Monday', page, {language: 'en'});

        expect(ways.points).toBeNull();
        expect(ways.summary).toBe('The SBB strike for 24 hours on Monday: 1,200 trains will not run.');
    });

    it('should give nothing when its model fails, Gemini never asked for it', async () => {
        chat.mockRejectedValue(Object.assign(new Error('down'), {status_code: 503}));

        expect(await aiWaysOf('SBB strike on Monday', page, {language: 'en'})).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should not ask the AI without a sentence to write from', async () => {
        expect(await aiWaysOf('A video', {content: '', blocks: []}, {language: 'en'})).toBeNull();
        expect(chat).not.toHaveBeenCalled();
    });
});
