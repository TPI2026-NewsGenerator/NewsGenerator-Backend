//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.repeats.js
//  Description: Tests for the stories shown before: left out of the next briefing unless news published
//               since tell something new, then back as a follow-up; a new story of the same affair
//               shown and said to follow the card of before
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {evolvedStories, normalizeEvolutions, shownStories, withoutRepeats} = await import('../../services/utils/repeats.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const at = (iso) => new Date(iso);
const story = (storyId, ...dates) => ({storyId, members: dates.map((date, i) => ({title: `News ${storyId}.${i}`, at: at(date)}))});

beforeEach(() => chat.mockReset());

describe('shownStories', () => {
    it('should keep the last time each story was shown, the stories joined to a card with it, never a card added by hand', () => {
        const shown = shownStories([
            {storyId: 1, mergedStoryIds: [5], title: 'First', shownAt: '2026-10-11T07:00:00Z'},
            {storyId: 1, mergedStoryIds: null, title: 'First again', shownAt: '2026-10-12T07:00:00Z'},
            {storyId: -1, mergedStoryIds: [], title: 'Added by the reader', shownAt: '2026-10-12T07:00:00Z'},
        ]);
        expect([...shown.keys()].sort()).toEqual([1, 5]);
        expect(shown.get(1)).toEqual({title: 'First again', shownAt: at('2026-10-12T07:00:00Z')});
        expect(shown.get(5).title).toBe('First');
    });
});

describe('normalizeEvolutions', () => {
    it('should keep only the stories asked answered true, with the fact named', () => {
        const asked = [{id: '1'}, {id: '2'}, {id: '3'}];
        const answer = {stories: [{id: '1', fact: 'the strike started', evolved: true}, {id: '[2]', evolved: 'true'}, {id: '3', evolved: false}, {id: '9', evolved: true}]};
        expect([...normalizeEvolutions(answer, asked)]).toEqual([['1', 'the strike started']]);
        expect(normalizeEvolutions(null, asked).size).toBe(0);
    });
});

describe('withoutRepeats', () => {
    const shown = new Map([
        [1, {title: 'Strike announced', shownAt: at('2026-10-12T07:00:00Z')}],
        [2, {title: 'Coach sacked', shownAt: at('2026-10-12T07:00:00Z')}],
        [3, {title: 'Storm forecast', shownAt: at('2026-10-12T07:00:00Z')}],
    ]);
    const threadOf = new Map([[1, 10], [2, 20], [3, 30], [4, 30], [5, null], [6, 60], [7, 10]]);

    it('should leave out what tells nothing new of an affair shown, and keep what does as a follow-up', async () => {
        const stories = [
            story(1, '2026-10-12T05:00:00Z', '2026-10-12T15:00:00Z'),      // shown, news since: asked, new
            story(2, '2026-10-11T20:00:00Z'),                              // shown, nothing since: left out unasked
            story(3, '2026-10-12T05:00:00Z', '2026-10-12T16:00:00Z'),      // shown, news since, the same fact
            story(4, '2026-10-12T18:00:00Z'),                              // another story of the storm: asked, new
            story(7, '2026-10-12T06:00:00Z'),                              // another story of the strike, older: asked with its news, the same fact
            story(5, '2026-10-12T18:00:00Z'),                              // never shown, no thread
            story(6, '2026-10-12T18:00:00Z'),                              // never shown, a thread of its own
        ];
        const evolved = jest.fn(async () => new Map([['1', 'the strike started'], ['4', 'the storm hit']]));
        const {stories: kept, left, back} = await withoutRepeats(stories, shown, threadOf, evolved);

        expect(kept.map(s => s.storyId)).toEqual([1, 4, 5, 6]);
        expect(left).toBe(3);
        expect(back).toEqual([{storyId: 1, fact: 'the strike started'}, {storyId: 4, fact: 'the storm hit'}]);
        // the news since, else all the news of another story of the affair, with the title read
        expect(evolved.mock.calls[0][0]).toEqual([
            {id: '1', title: 'Strike announced', since: [expect.objectContaining({title: 'News 1.1'})]},
            {id: '3', title: 'Storm forecast', since: [expect.objectContaining({title: 'News 3.1'})]},
            {id: '4', title: 'Storm forecast', since: [expect.objectContaining({title: 'News 4.0'})]},
            {id: '7', title: 'Strike announced', since: [expect.objectContaining({title: 'News 7.0'})]},
        ]);
        expect(kept[0].followUp).toEqual({storyId: 1, title: 'Strike announced', shownAt: '2026-10-12T07:00:00.000Z', evolved: true});
        expect(kept[1].followUp).toEqual({storyId: 3, title: 'Storm forecast', shownAt: '2026-10-12T07:00:00.000Z', evolved: false});
        expect(kept[2].followUp).toBeUndefined();
        expect(kept[3].followUp).toBeUndefined();
    });

    it('should leave out every story of an affair shown when the AI fails, and keep the others', async () => {
        const stories = [story(1, '2026-10-12T15:00:00Z'), story(4, '2026-10-12T18:00:00Z'), story(5, '2026-10-12T18:00:00Z')];
        const {stories: kept} = await withoutRepeats(stories, shown, threadOf, async () => { throw new Error('down'); });
        expect(kept.map(s => s.storyId)).toEqual([5]);
    });

    it('should change nothing and ask nothing when nothing was shown', async () => {
        const stories = [story(1, '2026-10-12T15:00:00Z')];
        const evolved = jest.fn();
        expect((await withoutRepeats(stories, new Map(), threadOf, evolved)).stories).toBe(stories);
        expect(evolved).not.toHaveBeenCalled();
    });
});

describe('evolvedStories', () => {
    it('should ask the AI once for every story, with the title read and the news', async () => {
        chat.mockResolvedValueOnce(json({stories: [{id: '7', fact: 'the strike started', evolved: true}]}));
        const ids = await evolvedStories([{id: '7', title: 'Strike announced', since: [{title: 'The strike started', description: '<p>Trains stopped</p>'}]}]);
        expect([...ids.keys()]).toEqual(['7']);
        const prompt = chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('[7] Read: "Strike announced"');
        expect(prompt).toContain('- The strike started — Trains stopped');
        expect(await evolvedStories([])).toEqual(new Map());
        expect(chat).toHaveBeenCalledTimes(1);
    });
});
