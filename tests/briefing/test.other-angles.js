//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.other-angles.js
//  Description: Tests for "Other angles": only the news the AI calls another angle of the card's affair
//               are kept, the closest first, MAX_ANGLES at most with a place for one found by names,
//               a card the AI failed on gets none
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {MAX_ANGLES, SAME_FACT_LIKENESS, normalizeAngles, otherAnglesOf, placeAngles, sameFactsOut} = await import('../../services/utils/other-angles.js');
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

    it('should keep every angle, placeAngles chooses the ones shown', () => {
        const answer = {news: list.map((other, i) => ({n: i + 1, kind: 'angle'}))};
        expect(normalizeAngles(answer, list)).toHaveLength(list.length);
    });

    it('should leave out numbers out of the list and answers of another shape', () => {
        expect(normalizeAngles({news: [{n: 0, kind: 'angle'}, {n: 9, kind: 'angle'}, {n: '2', kind: 'angle'}]}, list)
            .map(other => other.title)).toEqual(['A reaction']);
        expect(normalizeAngles({cards: []}, list)).toEqual([]);
        expect(normalizeAngles(null, list)).toEqual([]);
    });

    it('should note the earlier angle one tells the same fact as, never a later one or one not an angle', () => {
        const answer = {news: [{n: 2, kind: 'angle'}, {n: 4, kind: 'angle', as: 2}, {n: 5, kind: 'angle', as: 6},
            {n: 6, kind: 'angle', as: 1}, {n: 3, kind: 'theme'}]};
        expect(normalizeAngles(answer, list).map(other => [other.title, other.sameAs])).toEqual([
            ['A reaction', undefined], ['A later step', 101], ['A background', undefined], ['Its consequence', undefined]]);
    });
});

describe('sameFactsOut', () => {
    const angle = (storyId, sameAs) => ({storyId, title: `Story ${storyId}`, ...(sameAs ? {sameAs} : {})});
    const likeness = (pairs) => (a, b) => pairs[`${Math.min(a, b)}:${Math.max(a, b)}`] ?? 0;

    it('should leave out an angle the AI and the likeness both call the same fact as an earlier one', () => {
        const angles = [angle(1), angle(2, 1), angle(3, 1), angle(4)];
        expect(sameFactsOut(angles, likeness({'1:2': 0.93, '1:3': 0.8})).map(other => other.storyId)).toEqual([1, 3, 4]);
    });

    it('should keep it when the one it repeats is not shown below this card', () => {
        expect(sameFactsOut([angle(2, 1), angle(4)], likeness({'1:2': 0.95})).map(other => other.storyId)).toEqual([2, 4]);
    });

    it('should keep every angle without a likeness', () => {
        expect(sameFactsOut([angle(1), angle(2, 1)], () => 0)).toHaveLength(2);
    });

    it('should leave the place it frees to the next angle', () => {
        const angles = [angle(1), ...Array.from({length: MAX_ANGLES + 1}, (_, i) => angle(10 + i, i < 2 ? 1 : undefined))];
        const shown = placeAngles(sameFactsOut(angles, () => 0.9));
        expect(shown.map(other => other.storyId)).toEqual([1, 12, 13, 14, 15]);
        expect(SAME_FACT_LIKENESS).toBeGreaterThan(0.8);
    });
});

describe('placeAngles', () => {
    const angle = (title, named = false) => ({title, named});
    const titles = (list) => list.map(other => other.title);

    const closest = Array.from({length: MAX_ANGLES + 1}, (_, i) => angle(`Close ${i + 1}`));

    it('should show MAX_ANGLES at most, the closest first', () => {
        expect(titles(placeAngles(closest))).toEqual(titles(closest.slice(0, MAX_ANGLES)));
    });

    it('should give the last place to the first angle found by names when the closest fill them', () => {
        const angles = [...closest, angle('Earlier stance', true), angle('Other name', true)];
        const shown = placeAngles(angles);
        expect(shown).toHaveLength(MAX_ANGLES);
        expect(titles(shown)).toEqual([...titles(angles.slice(0, MAX_ANGLES - 1)), 'Earlier stance']);
    });

    it('should change nothing when an angle found by names is shown already or there is none', () => {
        expect(titles(placeAngles([angle('A'), angle('Earlier stance', true)]))).toEqual(['A', 'Earlier stance']);
        expect(titles(placeAngles([angle('A'), angle('B')], 1))).toEqual(['A']);
        expect(titles(placeAngles([angle('A'), angle('B'), angle('Named', true)], 1))).toEqual(['Named']);
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

    it("should give the AI the card's other titles, and none when it has no other", async () => {
        chat.mockResolvedValue(json({news: []}));
        await otherAnglesOf([
            {id: 1, title: 'A former Swiss defender runs for president', titles: ['Ex-Tottenham defender declares bid'], others: others('Un ex-Tottenham candidat')},
            {id: 2, title: 'A card told by one article', others: others('Anything')},
        ]);

        expect(chat.mock.calls[0][0].messages[0].content).toContain('Its own articles also title it: "Ex-Tottenham defender declares bid"');
        expect(chat.mock.calls[1][0].messages[0].content).not.toContain('Its own articles');
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
