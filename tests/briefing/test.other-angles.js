//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.other-angles.js
//  Description: Tests for "Other angles": only the news the AI calls another angle of the card's affair
//               are kept, the closest first, MAX_ANGLES at most, a card the AI failed on gets none
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {MAX_ANGLES, normalizeAngles, otherAnglesOf} = await import('../../services/utils/other-angles.js');
const {newUsage} = await import('../../services/utils/ollama.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const others = (...titles) => titles.map((title, i) => ({storyId: 100 + i, title}));

beforeEach(() => chat.mockReset());

describe('normalizeAngles', () => {
    const list = others('Same fact told again', 'A reaction', 'Another field', 'A later step', 'A background', 'Its consequence');

    it('should keep the angles only, in the order of the closest', () => {
        const answer = {news: [{n: 4, kind: 'angle'}, {n: 1, kind: 'same'}, {n: 2, kind: 'angle'}, {n: 3, kind: 'theme'}]};
        expect(normalizeAngles(answer, list).map(other => other.title)).toEqual(['A reaction', 'A later step']);
    });

    it('should keep MAX_ANGLES at most', () => {
        const answer = {news: list.map((other, i) => ({n: i + 1, kind: 'angle'}))};
        expect(normalizeAngles(answer, list)).toHaveLength(MAX_ANGLES);
    });

    it('should leave out numbers out of the list and answers of another shape', () => {
        expect(normalizeAngles({news: [{n: 0, kind: 'angle'}, {n: 9, kind: 'angle'}, {n: '2', kind: 'angle'}]}, list)
            .map(other => other.title)).toEqual(['A reaction']);
        expect(normalizeAngles({cards: []}, list)).toEqual([]);
        expect(normalizeAngles(null, list)).toEqual([]);
    });
});

describe('otherAnglesOf', () => {
    it('should ask once per card with others, the titles numbered, and count the tokens', async () => {
        chat.mockResolvedValueOnce(json({news: [{n: 1, kind: 'angle'}, {n: 2, kind: 'same'}]}));
        const usage = newUsage();
        const cards = [
            {id: 1, title: 'A federation files a complaint against the president', others: others('A summit to oust him', 'The complaint filed')},
            {id: 2, title: 'A card with nothing close', others: []},
        ];

        const angles = await otherAnglesOf(cards, usage);

        expect(chat).toHaveBeenCalledTimes(1);
        const prompt = chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('A news card: "A federation files a complaint against the president"');
        expect(prompt).toContain('[1] A summit to oust him\n[2] The complaint filed');
        expect(angles.get(1).map(other => other.title)).toEqual(['A summit to oust him']);
        expect(angles.has(2)).toBe(false);
        expect(usage).toEqual({calls: 1, input: 10, output: 5});
    });

    it('should give no angle to a card the AI failed on, the others kept', async () => {
        chat.mockImplementation(async ({messages}) => {
            // no JSON: a failure that asks no other AI
            if (messages[0].content.includes('broken')) return {message: {content: 'not json'}};
            return json({news: [{n: 1, kind: 'angle'}]});
        });
        const angles = await otherAnglesOf([
            {id: 1, title: 'A broken card', others: others('Anything')},
            {id: 2, title: 'A card', others: others('A reaction')},
        ]);

        expect(angles.get(1)).toEqual([]);
        expect(angles.get(2).map(other => other.title)).toEqual(['A reaction']);
    });
});
