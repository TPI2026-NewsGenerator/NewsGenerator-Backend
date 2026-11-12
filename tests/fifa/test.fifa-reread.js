//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-reread.js
//  Description: Tests for the reading again of a family of signals when a rule of the guide changes (FifaService.reread): the established signals whose words match are read
//               again by the same reading as the news that come, what would change is told and written only with apply, a signal that stays is left as it is, a reading the
//               model could not give changes nothing. The database and the AI are mocked
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const model = Object.fromEntries(['establishedMatching', 'updateSignal'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})}));
const {FifaService} = await import('../../services/fifa-service.js');

const SAFA = 'Q833624';
const row = (id, sentence, more = {}) => ({id, subject_qid: 'Q124138', member_qid: SAFA, hash: `h${id}`, matched: 'south african football association', sentence, title: sentence, description: '', lang: 'en',
    url: 'https://example.com', medium: 'example.com', published_at: new Date('2026-10-28'), stance: 'for', level: 'probable', subject_name: 'Gianni Infantino', ...more});
const label = (more = {}) => ({about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'for', toward: 'person', mark: 'official', level: 'probable', status: 'established',
    reason: '', confidence: 'high', note: '', quote: 'South African Football Association', speaker: 'Danny Jordaan', ...more});
const PRAISE = 'South African Football Association president Danny Jordaan thanked FIFA for backing African football, saying the continent has benefited under the leadership of the FIFA president';
const BACKS = 'South African Football Association president Danny Jordaan thanked Infantino and said the association will back his re-election';

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    ollamaJson.mockReset();
    model.updateSignal.mockResolvedValue(1);
    // the guide of now: the praise alone is uncertain (reason praise), the sentence that says it will back his re-election stays a position
    ollamaJson.mockImplementation(async (prompt) => {
        const text = String(prompt);
        const praise = text.includes('benefited under the leadership') && !text.includes('will back his re-election');
        return praise ? label({reason: 'praise'}) : label();
    });
});

describe('FifaService.reread', () => {
    it('should tell what would change and write nothing without apply', async () => {
        model.establishedMatching.mockResolvedValue([row(1, PRAISE), row(2, BACKS)]);
        const answer = await FifaService.reread({pattern: 'thank'});
        expect(model.establishedMatching).toHaveBeenCalledWith('thank');
        expect(answer).toMatchObject({read: 2, unchanged: 1, unread: 0, applied: 0});
        expect(answer.changed).toEqual([expect.objectContaining({id: 1, member: 'RSA', before: 'established for/probable', after: 'uncertain', reason: 'praise'})]);
        expect(model.updateSignal).not.toHaveBeenCalled();
    });

    it('should write only what changes with apply, as uncertain with its reason', async () => {
        model.establishedMatching.mockResolvedValue([row(1, PRAISE), row(2, BACKS)]);
        const answer = await FifaService.reread({pattern: 'thank', apply: true});
        expect(answer.applied).toBe(1);
        expect(model.updateSignal).toHaveBeenCalledTimes(1);
        expect(model.updateSignal).toHaveBeenCalledWith(1, expect.objectContaining({certainty: 'uncertain', uncertain_reason: 'praise', stance: 'for', confirmed: true}));
    });

    it('should keep only the changes that come from the rule when it is named, and tell the others as noise, never written', async () => {
        model.establishedMatching.mockResolvedValue([row(1, PRAISE), row(2, 'South African Football Association president says the association backs him')]);
        let call = 0;
        // the first signal is read as praise; the second is read established by the first model and not confirmed by the second (the usual variance)
        ollamaJson.mockImplementation(async (prompt) => {
            call++;
            if (String(prompt).includes('benefited under the leadership')) return label({reason: 'praise'});
            return call % 2 === 0 ? label({stance: 'against'}) : label();
        });
        const answer = await FifaService.reread({pattern: 'thank', reason: 'praise', apply: true});
        expect(answer.changed.map(one => one.id)).toEqual([1]);
        expect(answer.noise.map(one => one.id)).toEqual([2]);
        expect(answer.noise[0].reason).toBe('readings_disagree');
        expect(model.updateSignal).toHaveBeenCalledTimes(1);
        expect(model.updateSignal).toHaveBeenCalledWith(1, expect.objectContaining({uncertain_reason: 'praise'}));
    });

    it('should leave a signal as it is when the model gives no usable reading', async () => {
        model.establishedMatching.mockResolvedValue([row(1, PRAISE)]);
        ollamaJson.mockResolvedValue({nonsense: true});
        const answer = await FifaService.reread({pattern: 'thank', apply: true});
        expect(answer).toMatchObject({read: 1, unread: 1, applied: 0, changed: []});
        expect(model.updateSignal).not.toHaveBeenCalled();
    });

    it('should refuse to read again with no words of a family', async () => {
        await expect(FifaService.reread({pattern: ' '})).rejects.toMatchObject({status: 422});
        expect(model.establishedMatching).not.toHaveBeenCalled();
    });
});
