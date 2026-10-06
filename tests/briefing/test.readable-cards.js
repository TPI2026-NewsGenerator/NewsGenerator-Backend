//
//  Author: Fabian Rostello
//  Date: 06.10.2026
//  File: test.readable-cards.js
//  Description: A briefing never shows a card no article of which could be read (a paywall, a
//               protected site): the next story the AI chose takes its place
//

import {describe, expect, it, jest} from '@jest/globals';
import {readableCards} from '../../services/utils/readable-cards.js';

// stories read as readStories answers them: the ids in 'paywalled' could not be read, the ids in
// 'failed' were read but the AI did not answer
const reader = ({paywalled = [], failed = []} = {}) => jest.fn(async (stories) => stories.map(story => ({
    story,
    unreadable: paywalled.includes(story.id),
    summary: paywalled.includes(story.id) || failed.includes(story.id) ? null : {summary: `passages of ${story.id}`},
})));
const ids = (cards) => cards.map(card => card.story.id);
const stories = (...list) => list.map(id => ({id}));

describe('readableCards', () => {
    it('should keep the stories read, in their order, without reading the reserve', async () => {
        const read = reader();
        const {cards, unreadable} = await readableCards(stories('a', 'b', 'c'), stories('r1', 'r2'), read);
        expect(ids(cards)).toEqual(['a', 'b', 'c']);
        expect(unreadable).toBe(0);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it('should leave out a story behind a paywall and give its place to the next one chosen', async () => {
        const read = reader({paywalled: ['faz']});
        const {cards, unreadable} = await readableCards(stories('a', 'faz', 'c'), stories('r1', 'r2'), read);
        expect(ids(cards)).toEqual(['a', 'c', 'r1']);
        expect(cards.every(card => card.summary !== null)).toBe(true);
        expect(unreadable).toBe(1);
        // the reserve is read only for the places missing
        expect(read).toHaveBeenNthCalledWith(2, stories('r1'));
    });

    it('should go on through the reserve when the next story cannot be read either', async () => {
        const read = reader({paywalled: ['b', 'r1']});
        const {cards} = await readableCards(stories('a', 'b'), stories('r1', 'r2', 'r3'), read);
        expect(ids(cards)).toEqual(['a', 'r2']);
    });

    it('should show fewer cards rather than a card with nothing read when the reserve runs out', async () => {
        const read = reader({paywalled: ['b', 'c', 'r1']});
        const {cards, unreadable} = await readableCards(stories('a', 'b', 'c'), stories('r1'), read);
        expect(ids(cards)).toEqual(['a']);
        expect(unreadable).toBe(3);
    });

    it('should show no card at all when nothing could be read', async () => {
        const {cards} = await readableCards(stories('a', 'b'), [], reader({paywalled: ['a', 'b']}));
        expect(cards).toEqual([]);
    });

    it('should keep a card read whose passages the AI failed to choose', async () => {
        const {cards} = await readableCards(stories('a', 'b'), stories('r1'), reader({failed: ['b']}));
        expect(ids(cards)).toEqual(['a', 'b']);
    });

    it('should fill the place of a story left out while read (a page of Google News that is no news)', async () => {
        const read = jest.fn(async (list) => list.filter(story => story.id !== 'live')
            .map(story => ({story, unreadable: false, summary: {summary: story.id}})));
        const {cards} = await readableCards(stories('a', 'live'), stories('r1'), read);
        expect(ids(cards)).toEqual(['a', 'r1']);
    });

    it('should stop after a few rounds of reading, the briefing waiting for each', async () => {
        const read = reader({paywalled: ['b', 'r1', 'r2', 'r3']});
        const {cards} = await readableCards(stories('a', 'b'), stories('r1', 'r2', 'r3', 'r4'), read, {maxRefills: 2});
        expect(ids(cards)).toEqual(['a']);
        expect(read).toHaveBeenCalledTimes(3);
    });
});
