//
//  Author: Fabian Rostello
//  Date: 14.10.2026
//  File: test.ai-concurrency.js
//  Description: The calls of the server wait for one of the places Ollama cloud takes at once rather
//               than being refused (429), a place freed when its call ends or fails
//

import process from 'node:process';
import {afterAll, beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

process.env.AISTUDIO_API_KEY = 'test-key';
const {ollamaJson, newUsage} = await import('../../services/utils/ollama.js');

const realFetch = globalThis.fetch;
const geminiAnswer = (text) => ({ok: true, status: 200, json: async () => ({candidates: [{content: {parts: [{text}]}}]})});
const refused = (status) => Object.assign(new Error('refused'), {status_code: status});

beforeEach(() => {
    chat.mockReset();
    globalThis.fetch = jest.fn();
});
afterAll(() => {
    globalThis.fetch = realFetch;
});

describe('the calls of the server at once', () => {
    it('should send Ollama 6 calls at most at once, the next ones when one ends', async () => {
        let inFlight = 0, most = 0;
        chat.mockImplementation(async () => {
            most = Math.max(most, ++inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight--;
            return {message: {content: '{"a": 1}'}, prompt_eval_count: 1, eval_count: 1};
        });
        const usage = newUsage();

        const answers = await Promise.all(Array.from({length: 12}, () => ollamaJson('prompt', usage)));
        expect(answers).toHaveLength(12);
        expect(most).toBe(6);
        expect(usage.calls).toBe(12);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should free its place when a call fails', async () => {
        chat.mockRejectedValue(refused(503));
        globalThis.fetch.mockResolvedValue(geminiAnswer('{"a": 2}'));
        await Promise.all(Array.from({length: 8}, () => ollamaJson('prompt')));

        chat.mockReset();
        chat.mockResolvedValue({message: {content: '{"a": 3}'}});
        expect(await ollamaJson('prompt')).toEqual({a: 3});
    });
});
