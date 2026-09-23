//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: test.average-link.js
//  Description: How the articles telling the same news are grouped: an article joins the group it
//               resembles on average, so a single lucky link no longer drags a whole group along
//

import {averageLink} from '../../services/utils/grouping.js';

const THRESHOLD = 0.25;

// the articles arrive sorted by date, most recent first
const articles = (...ids) => ids.map(id => ({id}));
const pair = (id_a, id_b, score) => ({id_a: Math.min(id_a, id_b), id_b: Math.max(id_a, id_b), score});

// which ids ended up together, as sorted groups, so a test reads as the grouping it expects
const groupsOf = (list, pairs, threshold = THRESHOLD) => {
    const find = averageLink(list, pairs, threshold);
    const groups = new Map();
    for (let {id} of list) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
    return [...groups.values()].map(group => group.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
};

describe('grouping the articles telling the same news', () => {
    test('an article alone is a group of its own', () => {
        expect(groupsOf(articles(1, 2, 3), [])).toEqual([[1], [2], [3]]);
    });

    test('two titles above the threshold are one news', () => {
        expect(groupsOf(articles(1, 2), [pair(1, 2, 0.40)])).toEqual([[1, 2]]);
    });

    test('two titles under the threshold stay apart', () => {
        expect(groupsOf(articles(1, 2), [pair(1, 2, 0.20)])).toEqual([[1], [2]]);
    });

    test('a pair the database did not return counts as no resemblance at all', () => {
        expect(groupsOf(articles(1, 2), [])).toEqual([[1], [2]]);
    });

    // the whole point: A and B tell the same news, B and C too, but A and C have nothing in common
    test('a chain of two links does not make one group of three', () => {
        const pairs = [pair(1, 2, 0.40), pair(2, 3, 0.40)];

        // 3 resembles 2 at 0.40 but 1 at 0, so on average 0.20 against the group: below the bar
        expect(groupsOf(articles(1, 2, 3), pairs)).toEqual([[1, 2], [3]]);
    });

    test('but a third article resembling both of them joins them', () => {
        const pairs = [pair(1, 2, 0.40), pair(2, 3, 0.40), pair(1, 3, 0.30)];

        expect(groupsOf(articles(1, 2, 3), pairs)).toEqual([[1, 2, 3]]);
    });

    // the Guardian, the Independent and the BBC on one story: the BBC headline is terse and only
    // really matches the Guardian, but the average over the two carries it in
    test('a terse headline joins on the average of the group, not on its weakest link', () => {
        const pairs = [pair(1, 2, 0.33), pair(1, 3, 0.30), pair(2, 3, 0.22)];

        expect(groupsOf(articles(1, 2, 3), pairs)).toEqual([[1, 2, 3]]);
    });

    test('an article joins the group it resembles most, not the first one that fits', () => {
        const pairs = [pair(1, 3, 0.30), pair(2, 3, 0.60)];

        expect(groupsOf(articles(1, 2, 3), pairs)).toEqual([[1], [2, 3]]);
    });

    test('the group is named after its first article, which is the most recent', () => {
        const find = averageLink(articles(7, 8, 9), [pair(7, 8, 0.40)], THRESHOLD);

        expect(find(8)).toBe(7);
        expect(find(7)).toBe(7);
        expect(find(9)).toBe(9);
    });

    test('a score exactly on the threshold groups', () => {
        expect(groupsOf(articles(1, 2), [pair(1, 2, THRESHOLD)])).toEqual([[1, 2]]);
    });

    test('every article is in exactly one group', () => {
        const list = articles(1, 2, 3, 4, 5);
        const pairs = [pair(1, 2, 0.40), pair(3, 4, 0.50), pair(2, 3, 0.30)];

        const groups = groupsOf(list, pairs);
        expect(groups.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });
});
