//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-reading.js
//  Description: Tests for the reading of a passage for the map of the FIFA presidency (fifa-reading.js): the code leaves out a passage it cannot
//               attribute before any model is asked, the status is decided by the code from the closed words, what would colour is
//               read again by a second model and needs the same side, "declared" only when both say declared, and nothing colours
//               when the second reading is missing. The AI is mocked; what it reads is measured on the gold set (bench/fifa)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {memberOfFifa as member} from '../../services/utils/fifa-members.js';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {promptOf, readPassage} = await import('../../services/utils/fifa-reading.js');

const subject = {name: 'Gianni Infantino'};
const passage = (code, matched, sentence, more = {}) => ({
    hash: 'abcdef0123456789', member: member(code), matched, sentence, bound: 'loose', acronymOnly: false, stanceWords: {support: false, oppose: true},
    article: {id: 1, title: sentence, description: '', medium: 'example.com', lang: 'en', date: '2026-11-01', url: 'https://example.com/1', story: 1, ...more.article},
});
const SENTENCE = 'Danish FA chairman Jesper Moller says the Danish Football Association will not back Infantino';
const reading = (more = {}) => ({
    about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'against', toward: 'person', mark: 'official', level: 'declared', status: 'established',
    reason: '', confidence: 'high', note: '', quote: 'will not back Infantino', speaker: 'Jesper Moller', ...more,
});
const options = {firstModel: 'first-model', secondModel: 'second-model'};

beforeEach(() => ollamaJson.mockReset());

describe('readPassage', () => {
    it('should leave out a passage it cannot attribute, before asking any model', async () => {
        const result = await readPassage({passage: passage('JPN', 'JFA', 'Jordan FA president Prince Ali (JFA) opposes Infantino'), subject}, options);
        expect(result).toMatchObject({status: 'discarded', byCode: 'rival_country', readBy: []});
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should colour only what two models read the same, and say declared only when both do', async () => {
        ollamaJson.mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading());
        const both = await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options);
        expect(both).toMatchObject({status: 'established', stance: 'against', level: 'declared', speaker: 'Jesper Moller', speaker_kind: 'president', readBy: ['first-model', 'second-model'], confirmed: true});

        ollamaJson.mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading({level: 'probable'}));
        const less = await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options);
        expect(less).toMatchObject({status: 'established', level: 'probable'});
        expect(ollamaJson).toHaveBeenLastCalledWith(expect.any(String), null, expect.objectContaining({model: 'second-model', think: true, fallback: null}));
    });

    it('should keep what the second model does not confirm uncertain, never coloured', async () => {
        ollamaJson.mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading({stance: 'for'}));
        expect(await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options)).toMatchObject({status: 'uncertain', reason: 'readings_disagree'});

        ollamaJson.mockResolvedValueOnce(reading()).mockResolvedValueOnce(reading({status: 'uncertain', reason: 'not_binding', speaker_kind: 'deputy'}));
        expect(await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options)).toMatchObject({status: 'uncertain', reason: 'readings_disagree'});
    });

    it('should leave it uncertain and unconfirmed, to read again, when the second model gives nothing', async () => {
        ollamaJson.mockResolvedValueOnce(reading()).mockRejectedValue(new Error('402 credits'));
        const result = await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options);
        expect(result).toMatchObject({status: 'uncertain', reason: 'unconfirmed', confirmed: false});
    });

    it('should not colour a reading whose quote is not in the text', async () => {
        ollamaJson.mockResolvedValueOnce(reading({quote: 'the federation has resigned from FIFA'}));
        const result = await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options);
        expect(result).toMatchObject({status: 'uncertain', reason: 'ambiguous', quoteNotHeld: true});
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should decide the status itself: a model that calls a deputy "established" is uncertain, not binding', async () => {
        ollamaJson.mockResolvedValueOnce(reading({speaker_kind: 'deputy'}));
        const result = await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options);
        expect(result).toMatchObject({status: 'uncertain', reason: 'not_binding'});
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should leave out an answer that is not usable twice, uncertain and unconfirmed', async () => {
        ollamaJson.mockResolvedValue({nonsense: true});
        expect(await readPassage({passage: passage('DEN', 'danish football association', SENTENCE), subject}, options)).toMatchObject({status: 'uncertain', reason: 'unconfirmed', unreadable: true});
    });
});

describe('promptOf', () => {
    it('should hold the guide, the passage and the fields asked, and name the problems of a first answer', () => {
        const text = promptOf({passage: passage('DEN', 'danish football association', SENTENCE), subject}, ['status: "x" is none of']);
        expect(text).toContain('Annotation guide');
        expect(text).toContain('"candidate": "Gianni Infantino"');
        expect(text).toContain('speaker (the name of who says it');
        expect(text).toContain('broke the rules of the guide');
    });
});
