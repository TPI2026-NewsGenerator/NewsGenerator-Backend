//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.timeline-relevance.js
//  Description: Tests for the lines of "the story so far" a card keeps: only the earlier news of its own affair (a card of the FKF of Kenya
//               had the lines of the NFF of Nigeria, a friend of the user, 12.11.2026), the lines left as they are when the AI cannot say
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat: jest.fn()}))}));
const {RELATED_DEFINITION, normalizeRelated, relatedLines, relatedPrompt} = await import('../../services/utils/timeline-relevance.js');

const card = {title: 'Ousted FKF NEC members call for FIFA-backed normalization committee', summary: 'Seven Football Kenya Federation officials say they are ready.'};
const lines = [
    {date: '2026-10-31', title: 'FIFA Approves Normalisation Committee to Run Nigeria football', medium: 'thisdaylive.com'},
    {date: '2026-11-06', title: 'FKF delegates call Special General Meeting in Meru', medium: 'eastleighvoice.co.ke'},
    {date: '2026-11-07', title: 'Mariga and allies expelled from Football Kenya Federation', medium: 'k24.digital'},
];

describe('relatedPrompt', () => {
    it('should give the card, then its earlier stories numbered from 1 with their date and medium', () => {
        const prompt = relatedPrompt(card, lines);
        expect(prompt).toContain(RELATED_DEFINITION);
        expect(prompt).toContain(`CARD: ${card.title}`);
        expect(prompt).toContain('[1] 2026-10-31 thisdaylive.com: FIFA Approves Normalisation Committee to Run Nigeria football');
        expect(prompt).toContain('[3] 2026-11-07 k24.digital: Mariga and allies expelled from Football Kenya Federation');
        expect(prompt).toContain('{"same": [');
    });

    it('should tell that the same kind of story somewhere else is not the same affair', () => {
        expect(RELATED_DEFINITION).toMatch(/same kind of story somewhere else/);
        expect(RELATED_DEFINITION).toMatch(/other parties/);
    });

    it('should cut the summary of the card', () => {
        const prompt = relatedPrompt({title: 'T', summary: `${'a '.repeat(400)}END`}, lines);
        expect(prompt).not.toContain('END');
    });
});

describe('normalizeRelated', () => {
    it('should answer the places kept from 0, once each, and none outside the lines', () => {
        expect(normalizeRelated({same: [2, 3, 3, 9, 0, -1, 'x']}, 3)).toEqual([1, 2]);
        expect(normalizeRelated({same: ['[1]', '2']}, 3)).toEqual([0, 1]);
    });

    it('should answer an empty list when the AI keeps no line, and null when its answer is no list', () => {
        expect(normalizeRelated({same: []}, 3)).toEqual([]);
        expect(normalizeRelated({translations: ['a']}, 3)).toBeNull();
        expect(normalizeRelated(null, 3)).toBeNull();
        expect(normalizeRelated({same: '1,2'}, 3)).toBeNull();
    });
});

describe('relatedLines', () => {
    it('should keep the lines the AI says are of the same affair, in their order', async () => {
        const ask = jest.fn(async () => ({same: [2, 3]}));
        expect(await relatedLines(card, lines, null, ask)).toEqual([lines[1], lines[2]]);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('should keep none when the AI says none (the six lines of Nigeria on a card of Kenya)', async () => {
        expect(await relatedLines(card, lines, null, async () => ({same: []}))).toEqual([]);
    });

    it('should leave the lines as they are when the AI fails or answers no list: the card is never kept waiting', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await relatedLines(card, lines, null, async () => { throw new Error('down'); })).toEqual(lines);
        expect(await relatedLines(card, lines, null, async () => ({text: 'nothing'}))).toEqual(lines);
        error.mockRestore();
    });

    it('should ask nothing for a card with no earlier story', async () => {
        const ask = jest.fn();
        expect(await relatedLines(card, [], null, ask)).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
    });
});
