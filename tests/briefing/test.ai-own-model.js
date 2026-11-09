//
//  Author: Fabian Rostello
//  Date: 08.11.2026
//  File: test.ai-own-model.js
//  Description: A call that names its own model (deepseek-v4-pro for the AI version and the analysis, see ai-ways.js and card-analysis.js)
//               goes to gemma4:31b when that model fails, never to Gemini; a model the plan refuses (401, 402, 403, 404, 429) is left
//               aside for a while, any other failure is not remembered; the model that answered is told
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

process.env.AISTUDIO_API_KEY = 'test-key';
const {ollamaJson, newUsage, FALLBACK_MODEL} = await import('../../services/utils/ollama.js');

const OWN = 'deepseek-v4-pro:0813';
const answer = (json) => ({message: {content: JSON.stringify(json)}, prompt_eval_count: 5, eval_count: 3});
const failed = (status, message = 'failed') => Object.assign(new Error(message), {status_code: status});
const modelsAsked = () => chat.mock.calls.map(([request]) => request.model);

beforeEach(() => {
    chat.mockReset();
    globalThis.fetch = jest.fn();
});

describe('a call with its own model', () => {
    it('should be answered by that model, which is told', async () => {
        chat.mockResolvedValueOnce(answer({a: 1}));
        const usage = newUsage();
        const told = [];

        expect(await ollamaJson('prompt', usage, {model: OWN, think: false, onModel: model => told.push(model)})).toEqual({a: 1});
        expect(modelsAsked()).toEqual([OWN]);
        expect(told).toEqual([OWN]);
        expect(usage.models).toEqual([OWN]);
    });

    it('should go to gemma4:31b when it fails, never to Gemini, and say who answered', async () => {
        expect(FALLBACK_MODEL).toBe('gemma4:31b');
        chat.mockRejectedValueOnce(failed(500)).mockResolvedValueOnce(answer({a: 2}));
        const usage = newUsage();
        const told = [];

        expect(await ollamaJson('prompt', usage, {model: OWN, think: true, timeoutMs: 5e3, onModel: model => told.push(model)})).toEqual({a: 2});
        expect(modelsAsked()).toEqual([OWN, FALLBACK_MODEL]);
        // the reasoning and the time it is given follow
        expect(chat.mock.calls[1][0].think).toBe(true);
        expect(told).toEqual([FALLBACK_MODEL]);
        expect(usage.models).toEqual([FALLBACK_MODEL]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should not remember a failure that is no refusal of the plan: the model is asked first again', async () => {
        chat.mockRejectedValueOnce(failed(500)).mockResolvedValueOnce(answer({a: 3})).mockResolvedValueOnce(answer({a: 4}));

        await ollamaJson('first', null, {model: OWN});
        await ollamaJson('second', null, {model: OWN});

        expect(modelsAsked()).toEqual([OWN, FALLBACK_MODEL, OWN]);
    });

    it('should fail when both fail, Gemini never asked', async () => {
        chat.mockRejectedValue(failed(500));

        await expect(ollamaJson('prompt', null, {model: OWN})).rejects.toMatchObject({status_code: 500});
        expect(modelsAsked()).toEqual([OWN, FALLBACK_MODEL]);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should leave out the fallback when the call says none', async () => {
        chat.mockRejectedValueOnce(failed(500));

        await expect(ollamaJson('prompt', null, {model: OWN, fallback: null})).rejects.toMatchObject({status_code: 500});
        expect(modelsAsked()).toEqual([OWN]);
    });

    it('should not ask the fallback again for a model that is the fallback', async () => {
        chat.mockRejectedValueOnce(failed(500));

        await expect(ollamaJson('prompt', null, {model: FALLBACK_MODEL})).rejects.toMatchObject({status_code: 500});
        expect(modelsAsked()).toEqual([FALLBACK_MODEL]);
    });

    // last: the model stays aside after it
    it('should leave a model the plan refuses aside for a while, the next calls going to the fallback at once', async () => {
        chat.mockRejectedValueOnce(failed(403, 'this model requires a subscription')).mockResolvedValue(answer({a: 5}));

        await ollamaJson('first', null, {model: OWN});
        await ollamaJson('second', null, {model: OWN});
        await ollamaJson('third', null, {model: OWN});

        expect(modelsAsked()).toEqual([OWN, FALLBACK_MODEL, FALLBACK_MODEL, FALLBACK_MODEL]);
    });
});
