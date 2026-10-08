//
//  Author: Fabian Rostello
//  Date: 01.10.2026
//  File: test.ai-fallback.js
//  Description: The Gemini API answers in the place of Ollama when Ollama fails, and only then
//

import process from 'node:process';
import {afterAll, beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

process.env.AISTUDIO_API_KEY = 'test-key';
const {ollamaJson, newUsage} = await import('../../services/utils/ollama.js');

const realFetch = globalThis.fetch;
const geminiAnswer = (text, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => status < 400
        ? {candidates: [{content: {parts: [{text: 'reasoning', thought: true}, {text}]}}],
            usageMetadata: {promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2}}
        : {error: {message: 'Internal error encountered.'}},
});
const refused = (status) => Object.assign(new Error('refused'), {status_code: status});

beforeEach(() => {
    chat.mockReset();
    globalThis.fetch = jest.fn();
});
afterAll(() => {
    globalThis.fetch = realFetch;
});

describe('the AI', () => {
    it('should answer with Ollama when it works, Gemini never asked', async () => {
        chat.mockResolvedValueOnce({message: {content: '{"a": 1}'}, prompt_eval_count: 5, eval_count: 3});
        const usage = newUsage();

        expect(await ollamaJson('prompt', usage)).toEqual({a: 1});
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(usage).toEqual({calls: 1, input: 5, output: 3});
    });

    it('should ask Gemini when Ollama is down, its reasoning left out and its tokens counted', async () => {
        chat.mockRejectedValueOnce(refused(503));
        globalThis.fetch.mockResolvedValueOnce(geminiAnswer('```json\n{"a": 2}\n```'));
        const usage = newUsage();

        expect(await ollamaJson([{role: 'user', content: 'q'}, {role: 'assistant', content: 'r'}, {role: 'user', content: 'q2'}], usage)).toEqual({a: 2});
        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.contents.map(content => content.role)).toEqual(['user', 'model', 'user']);
        expect(body.generationConfig.thinkingConfig).toEqual({thinkingLevel: 'minimal'});
        expect(usage).toEqual({calls: 1, input: 10, output: 6});
    });

    it('should ask Gemini again once after an error 500', async () => {
        chat.mockRejectedValueOnce(new Error('fetch failed'));
        globalThis.fetch.mockResolvedValueOnce(geminiAnswer('', 500)).mockResolvedValueOnce(geminiAnswer('{"a": 3}'));

        expect(await ollamaJson('prompt')).toEqual({a: 3});
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('should fail when both fail', async () => {
        chat.mockRejectedValueOnce(refused(500));
        globalThis.fetch.mockResolvedValue(geminiAnswer('', 500));

        await expect(ollamaJson('prompt')).rejects.toMatchObject({status: 502});
    });

    it('should not ask Gemini when Ollama answered something else than JSON', async () => {
        chat.mockResolvedValueOnce({message: {content: 'not json'}});

        await expect(ollamaJson('prompt')).rejects.toThrow('The AI did not answer in JSON.');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should ask Ollama again when its queue is full, without leaving it aside', async () => {
        jest.useFakeTimers();
        const busy = Object.assign(new Error('too many concurrent requests'), {status_code: 429});
        chat.mockRejectedValueOnce(busy).mockRejectedValueOnce(busy)
            .mockResolvedValueOnce({message: {content: '{"a": 5}'}})
            .mockResolvedValueOnce({message: {content: '{"a": 6}'}});

        const answer = ollamaJson('first');
        await jest.advanceTimersByTimeAsync(7e3);
        expect(await answer).toEqual({a: 5});
        expect(await ollamaJson('second')).toEqual({a: 6});
        expect(chat).toHaveBeenCalledTimes(4);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        jest.useRealTimers();
    });

    // last: Ollama stays paused after it
    it('should leave Ollama aside for a while once its quota is used up', async () => {
        chat.mockRejectedValueOnce(refused(429));
        globalThis.fetch.mockResolvedValue(geminiAnswer('{"a": 4}'));

        await ollamaJson('first');
        await ollamaJson('second');

        expect(chat).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
});
