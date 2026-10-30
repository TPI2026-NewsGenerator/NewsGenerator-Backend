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

    it('should ask again once a call failed or gave a figure the article does not have (28.10.2026)', async () => {
        const calls = {points: 0, summary: 0};
        chat.mockImplementation(async ({messages}) => {
            const kind = messages[0].content.startsWith('You write the key points') ? 'points' : 'summary';
            calls[kind]++;
            if (kind === 'points') {
                if (calls.points === 1) throw Object.assign(new Error('timeout'), {status_code: 500});
                return answer({points: [{text: 'A strike of 24 hours on Monday.'}]});
            }
            return answer({summary: calls.summary === 1 ? 'A strike of 48 hours.' : 'A strike of 24 hours on Monday.'});
        });

        const ways = await aiWaysOf('SBB strike on Monday', page, {language: 'en'});

        expect(ways).toEqual({points: ['A strike of 24 hours on Monday.'], summary: 'A strike of 24 hours on Monday.', model: WRITE_MODEL});
        expect(calls).toEqual({points: 2, summary: 2});
    });

    it('should not ask a third time, nor again when the first answer is right', async () => {
        answering({points: {points: [{text: 'A strike of 48 hours on Monday.'}]}, summary: {summary: 'A strike of 24 hours on Monday.'}});

        const ways = await aiWaysOf('SBB strike on Monday', page, {language: 'en'});

        expect(ways.points).toBeNull();
        expect(ways.summary).toBe('A strike of 24 hours on Monday.');
        expect(chat).toHaveBeenCalledTimes(3);
    });

    it('should tell the AI which figures are not the article\'s when it asks again, and keep the points that are right', async () => {
        const asked = [];
        chat.mockImplementation(async ({messages}) => {
            asked.push(messages[0].content);
            return messages[0].content.startsWith('You write the key points')
                ? answer({points: [{text: 'A strike of 24 hours on Monday.'}, {text: 'A strike of 48 hours.'}]})
                : answer({summary: 'A strike of 24 hours on Monday.'});
        });

        const ways = await aiWaysOf('SBB strike on Monday', page, {language: 'en'});

        // the second answer is as wrong as the first: the point that is right stays, the other goes
        expect(ways.points).toEqual(['A strike of 24 hours on Monday.']);
        const again = asked.filter(prompt => prompt.includes('Your previous answer has figures the article does not give: 48.'));
        expect(again).toHaveLength(1);
        expect(again[0]).toMatch(/^You write the key points/);
    });

    it('should take a round of 16 for the eighth-finals the article writes in words, and a time in its other form', async () => {
        const cup = {content: '', blocks: [
            {kind: 'text', text: 'Der VAR kommt ab dem Achtelfinale des Pokals zum Einsatz.'},
            {kind: 'text', text: 'Das Spiel beginnt am Samstag um 20h15 in Zürich.'},
        ]};
        answering({points: {points: [{text: 'VAR is used from the round of 16.'}, {text: 'The match starts on Saturday at 20:15.'}]},
            summary: {summary: 'VAR comes in the round of 16, the match is on Saturday at 8:15 p.m.'}});

        const ways = await aiWaysOf('VAR im Pokal', cup, {language: 'en'});

        expect(ways.points).toHaveLength(2);
        expect(ways.summary).toContain('round of 16');
        expect(chat).toHaveBeenCalledTimes(2);
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
