//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.name-review.js
//  Description: The names of a card that no item of Wikidata stands for and that are no names (name-review.js): what the AI is shown, what of its
//               answer is kept, and that only a name with no item is left out
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {namesToReview, normalizeNotNames, reviewNames, reviewPrompt, withoutNonNames} = await import('../../services/utils/name-review.js');

const card = (storyId, title, names, changes = {}) => ({storyId, title, names, ...changes});
const quiet = () => ({log: jest.fn(), error: jest.fn()});

beforeEach(() => ollamaJson.mockReset());

describe('namesToReview', () => {
    it('should give once each the names with no item, with the kind and the title of the first card that shows them', () => {
        const items = [
            card(1, 'Genoa and Milan draw', [{name: 'Genoa-Milan', qid: null, kind: 'organization'}, {name: 'UEFA', qid: 'Q35572', kind: 'organization'}]),
            card(2, 'Another card', [{name: 'Genoa-Milan', qid: null, kind: 'organization'}, {name: 'Hotline', qid: null, kind: 'organization'}], {titleTranslation: 'Une autre carte'}),
            card(3, 'No names', undefined),
        ];
        expect(namesToReview(items)).toEqual([
            {name: 'Genoa-Milan', kind: 'organization', title: 'Genoa and Milan draw'},
            {name: 'Hotline', kind: 'organization', title: 'Une autre carte'},
        ]);
    });
});

describe('reviewPrompt and normalizeNotNames', () => {
    it('should number the names with their kind and card, and say a name in doubt is a name', () => {
        const prompt = reviewPrompt([{name: 'Genoa-Milan', kind: 'organization', title: 'Genoa and Milan draw'}, {name: 'Hotline', kind: 'organization', title: 'Card'}]);
        expect(prompt).toContain('[1] Genoa-Milan (organization) — card: Genoa and Milan draw');
        expect(prompt).toContain('[2] Hotline (organization) — card: Card');
        expect(prompt).toContain('When in doubt, it is a name.');
    });

    it('should keep the numbers of the list, from zero, with why, and nothing else', () => {
        const flagged = normalizeNotNames({not_names: [{n: 2, why: 'match'}, {n: '3'}, {n: 9, why: 'x'}, {n: 1.5}, null, {n: 0}]}, 4);
        expect([...flagged]).toEqual([[1, 'match'], [2, 'other']]);
        for (const answer of [null, 'yes', {not_names: 'no'}, {}, []]) expect(normalizeNotNames(answer, 3).size).toBe(0);
    });
});

describe('reviewNames', () => {
    const items = [card(1, 'Genoa and Milan draw', [{name: 'Genoa-Milan', qid: null, kind: 'organization'}, {name: 'Flamingos', qid: null, kind: 'organization'},
        {name: 'Valencia', qid: null, kind: 'organization'}, {name: 'UEFA', qid: 'Q35572', kind: 'organization'}]),
    card(2, 'Another card', [{name: 'Hotline', qid: null, kind: 'organization'}, {name: 'Mamady Doumbouya', qid: null, kind: 'person'}, {name: 'FIFA', qid: 'Q253414', kind: 'organization'},
        {name: 'Roma', qid: null, kind: 'organization'}, {name: 'Sporting', qid: null, kind: 'organization'}])];

    it('should ask once for the names with no item and answer the ones that are none, by their name', async () => {
        ollamaJson.mockResolvedValue({not_names: [{n: 1, why: 'match'}, {n: 4, why: 'common noun'}]});
        const log = quiet();
        const flagged = await reviewNames(items, {label: 7, log});
        expect([...flagged]).toEqual([['Genoa-Milan', 'match'], ['Hotline', 'common noun']]);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect(ollamaJson.mock.calls[0][0]).not.toContain('UEFA');
        expect(log.log.mock.calls[0][0]).toMatch(/Briefing 7: names: 7 names with no item reviewed .* 2 are no names/);
    });

    it('should ask in lots of 40, each numbered from one', async () => {
        const many = [card(1, 'Many', Array.from({length: 45}, (_, i) => ({name: `Name ${i}`, qid: null, kind: 'person'})))];
        ollamaJson.mockImplementation(async (prompt) => prompt.includes('Name 44 (') ? {not_names: [{n: 5, why: 'other'}]} : {not_names: []});
        const flagged = await reviewNames(many, {log: quiet()});
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        expect([...flagged]).toEqual([['Name 44', 'other']]);
    });

    it('should not believe an AI that points at most of the names, nor leave anything out then', async () => {
        ollamaJson.mockResolvedValue({not_names: [1, 2, 3, 4, 5].map(n => ({n, why: 'other'}))});
        const log = quiet();
        expect((await reviewNames(items, {label: 3, log})).size).toBe(0);
        expect(log.error.mock.calls[0][0]).toMatch(/Briefing 3: names: the AI points at 5 of 7 names with no item, not believed/);
    });

    it('should never fail: the AI failing or answering what cannot be read leaves the names, and a call that fails costs only its names', async () => {
        ollamaJson.mockRejectedValue(new Error('down'));
        const log = quiet();
        expect((await reviewNames(items, {log})).size).toBe(0);
        expect(log.error).toHaveBeenCalled();
        ollamaJson.mockReset().mockResolvedValue('nonsense');
        expect((await reviewNames(items, {log: quiet()})).size).toBe(0);
        ollamaJson.mockReset().mockImplementation(() => { throw new Error('sync failure'); });
        expect((await reviewNames(items, {log: quiet()})).size).toBe(0);
    });

    it('should ask nothing when every name has an item, or when it is switched off', async () => {
        expect((await reviewNames([card(1, 'Linked', [{name: 'FIFA', qid: 'Q253414', kind: 'organization'}])], {log: quiet()})).size).toBe(0);
        process.env.AI_NAME_REVIEW = 'off';
        try {
            expect((await reviewNames(items, {log: quiet()})).size).toBe(0);
        } finally {
            delete process.env.AI_NAME_REVIEW;
        }
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should count the tokens of its calls in the usage it is given', async () => {
        const usage = {calls: 0, input: 0, output: 0};
        ollamaJson.mockImplementation(async (prompt, counted) => {
            counted.calls += 1;
            counted.output += 30;
            return {not_names: []};
        });
        await reviewNames(items, {usage, log: quiet()});
        expect(usage).toEqual({calls: 1, input: 0, output: 30});
    });
});

describe('withoutNonNames', () => {
    it('should leave out of a card the names with no item that were pointed at, say which, and keep the others and the cards with none', () => {
        const items = [card(1, 'Genoa and Milan draw', [{name: 'Genoa-Milan', qid: null, kind: 'organization'}, {name: 'UEFA', qid: 'Q35572', kind: 'organization'}]),
            card(2, 'Nothing pointed at', [{name: 'Valencia', qid: null, kind: 'organization'}])];
        const log = quiet();
        const done = withoutNonNames(items, new Map([['Genoa-Milan', 'match']]), {label: 4, log});
        expect(done[0].names).toEqual([{name: 'UEFA', qid: 'Q35572', kind: 'organization'}]);
        expect(done[0].namesLeftOut).toEqual([{name: 'Genoa-Milan', why: 'match'}]);
        expect(done[1]).toBe(items[1]);
        expect(items[0].names).toHaveLength(2);
        expect(log.log.mock.calls[0][0]).toBe('Briefing 4: names: "Genoa-Milan" (match) left out of the card "Genoa and Milan draw"');
    });

    it('should never leave out a name that is linked, whatever the AI said of its name', () => {
        const items = [card(1, 'Hotline', [{name: 'Hotline', qid: 'Q1', kind: 'organization'}, {name: 'Hotline', qid: null, kind: 'organization'}])];
        const [done] = withoutNonNames(items, new Map([['Hotline', 'common noun']]), {log: quiet()});
        expect(done.names).toEqual([{name: 'Hotline', qid: 'Q1', kind: 'organization'}]);
    });
});
