//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.card-merge.js
//  Description: The cards of one news (card-merge.js): what the readers are shown, the groups both give, and the fold of the second card of
//               a news among the angles of the other, so that no news is hidden
//
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {agreedGroups, foldCards, mergePrompt, MERGE_MODEL, normalizeGroups, sameNewsGroups} = await import('../../services/utils/card-merge.js');
const {ORIGINAL_START, ORIGINAL_END} = await import('../../services/utils/original-marks.js');

const card = (storyId, title, media = 1, changes = {}) => ({
    storyId, title, mergedStoryIds: [], language: 'en', summary: `${title} is told in a first sentence of its own.\n\nA second paragraph.`,
    names: [{name: 'Adriano Galliani'}, {name: 'FIGC'}], angles: [], articles: [{url: `https://media${storyId}.example/a`, source: `media${storyId}.example`, title}],
    lead: {title, url: `https://media${storyId}.example/a`, source: `media${storyId}.example`, publishedAt: '2026-11-08T10:00:00.000Z', trusted: false, language: 'en'},
    corroboration: {media, read: media, independent: media, agencies: [], mediaNames: Array.from({length: media}, (_, i) => `media${storyId}-${i}.example`)}, ...changes,
});
const quiet = () => ({log: jest.fn(), error: jest.fn()});

beforeEach(() => ollamaJson.mockReset());

describe('mergePrompt', () => {
    it('should number the cards and show their title, media, names and first words, in the language of the reader', () => {
        const items = [card(1, 'Galliani backed by players', 17), card(2, 'FIGC presidency: a major shift', 1, {titleTranslation: 'Présidence de la FIGC', translation: `${ORIGINAL_START}(Un.)${ORIGINAL_END} Deux.\n\nTrois.`})];
        const prompt = mergePrompt(items, 'fr');
        expect(prompt).toContain('The reader reads in French.');
        expect(prompt).toContain('[1] Galliani backed by players\n    17 media | names: Adriano Galliani, FIGC\n    Galliani backed by players is told in a first sentence of its own.');
        expect(prompt).toContain('[2] Présidence de la FIGC\n    1 media');
        expect(prompt).toContain('(Un.) Deux.');
        expect(prompt).not.toContain('Trois.');
        expect(prompt).toContain('When in doubt, do not group.');
    });
});

describe('normalizeGroups', () => {
    it('should keep the groups of two cards or more of the briefing, from zero, sorted and once', () => {
        expect(normalizeGroups({groups: [{cards: [5, 2, 2, '7']}, {cards: [1]}, {cards: [3, 99]}, {cards: 'no'}, null, {cards: [4, 3]}]}, 8)).toEqual([[1, 4, 6], [2, 3]]);
    });

    it('should keep nothing of an answer that is not a list of groups', () => {
        for (const answer of [null, 'yes', {groups: 'no'}, {cards: [1, 2]}, []]) expect(normalizeGroups(answer, 5)).toEqual([]);
    });
});

describe('agreedGroups', () => {
    it('should keep the pairs both readers give, and none that one gives', () => {
        expect(agreedGroups([[0, 3], [1, 2]], [[1, 2], [4, 5]])).toEqual([[1, 2]]);
        expect(agreedGroups([[0, 1]], [])).toEqual([]);
    });

    it('should join three cards only when every one is paired with every other one, by both', () => {
        expect(agreedGroups([[0, 1, 2]], [[0, 1, 2]])).toEqual([[0, 1, 2]]);
        // A with B and B with C do not make A with C: how a development is taken for the news itself
        expect(agreedGroups([[0, 1], [1, 2]], [[0, 1], [1, 2]])).toEqual([[0, 1]]);
        expect(agreedGroups([[0, 1, 2]], [[0, 1], [1, 2]])).toEqual([[0, 1]]);
    });

    it('should keep two news of one briefing apart', () => {
        expect(agreedGroups([[0, 5], [2, 3]], [[2, 3], [0, 5]])).toEqual([[0, 5], [2, 3]]);
    });
});

describe('foldCards', () => {
    it('should put the second card of a news among the angles of the best covered one, in the place of the first, and count their media together', () => {
        const items = [card(1, 'FIGC presidency: a major shift', 1), card(2, 'Another news', 3), card(3, 'Official: Galliani backed by players', 17, {
            titleTranslation: 'Officiel : Galliani soutenu', angles: [{title: 'Old angle', url: 'https://old.example/a', storyId: 9}]})];
        items[0].corroboration.mediaNames = ['calciomio.fr'];
        items[2].corroboration.mediaNames = ['football-italia.net', 'calciomio.fr', 'tuttosport.com'];
        const log = quiet();
        const done = foldCards(items, [[0, 2]], {label: 5, log});

        expect(done.map(one => one.storyId)).toEqual([3, 2]);
        const [kept] = done;
        expect(kept.title).toBe('Official: Galliani backed by players');
        expect(kept.angles).toEqual([
            expect.objectContaining({title: 'FIGC presidency: a major shift', titleTranslation: null, url: 'https://media1.example/a', source: 'media1.example', storyId: 1, media: 1, folded: true, language: 'en'}),
            {title: 'Old angle', url: 'https://old.example/a', storyId: 9},
        ]);
        expect(kept.mergedStoryIds).toEqual([1]);
        expect(kept.joinedCards).toEqual([{storyId: 1, title: 'FIGC presidency: a major shift'}]);
        expect(kept.articles.map(article => article.url)).toEqual(['https://media3.example/a', 'https://media1.example/a']);
        // the media of the two, the one they share counted once
        expect(kept.corroboration.mediaNames).toEqual(['football-italia.net', 'calciomio.fr', 'tuttosport.com']);
        expect(kept.corroboration.media).toBe(17);
        expect(done[1]).toBe(items[1]);
        expect(items[0].angles).toEqual([]);
        expect(log.log.mock.calls[0][0]).toMatch(/Briefing 5: same news: "FIGC presidency: a major shift" is among the angles of "Officiel : Galliani soutenu"/);
    });

    it('should keep the first card when it is as well covered as the other, and show the title the reader saw in the angle', () => {
        const items = [card(1, 'First', 2), card(2, 'Second', 2, {titleTranslation: 'Deuxième', language: 'de'})];
        const [kept] = foldCards(items, [[0, 1]], {log: quiet()});
        expect(kept.storyId).toBe(1);
        expect(kept.angles[0]).toMatchObject({title: 'Second', titleTranslation: 'Deuxième', language: 'de', storyId: 2});
    });

    it('should not repeat as an angle the article or the story of the card that is folded', () => {
        const items = [card(1, 'First', 2, {angles: [{title: 'Second as an angle', url: 'https://media2.example/a', storyId: 77}, {title: 'Other story', url: 'https://x.example/a', storyId: 2}, {title: 'Kept', url: 'https://k.example/a', storyId: 5}]}), card(2, 'Second', 1)];
        const [kept] = foldCards(items, [[0, 1]], {log: quiet()});
        expect(kept.angles.map(angle => angle.title)).toEqual(['Second', 'Kept']);
    });

    it('should fold two news of a briefing separately, and leave the cards out of a group as they are', () => {
        const items = [card(1, 'A1', 1), card(2, 'B1', 1), card(3, 'A2', 4), card(4, 'C', 1), card(5, 'B2', 1)];
        const done = foldCards(items, [[0, 2], [1, 4]], {log: quiet()});
        expect(done.map(one => one.storyId)).toEqual([3, 2, 4]);
        expect(done[1].angles.map(angle => angle.storyId)).toEqual([5]);
        expect(done[2]).toBe(items[3]);
        expect(foldCards(items, [], {log: quiet()})).toEqual(items);
    });

    it('should fold three cards of one news into one', () => {
        const items = [card(1, 'One', 1), card(2, 'Two', 5), card(3, 'Three', 2)];
        const done = foldCards(items, [[0, 1, 2]], {log: quiet()});
        expect(done).toHaveLength(1);
        expect(done[0].storyId).toBe(2);
        expect(done[0].angles.map(angle => angle.storyId)).toEqual([1, 3]);
        expect(done[0].mergedStoryIds).toEqual([1, 3]);
    });

    it('should fold a card that has no corroboration, mergedStoryIds or angles of its own', () => {
        const bare = {storyId: 1, title: 'Bare', lead: {url: 'https://bare.example/a'}};
        const [kept] = foldCards([bare, card(2, 'Second', 1)], [[0, 1]], {log: quiet()});
        expect(kept.storyId).toBe(1);
        expect(kept.angles).toHaveLength(1);
        expect(kept.mergedStoryIds).toEqual([2]);
        expect(kept.corroboration).toBeUndefined();
    });
});

describe('sameNewsGroups', () => {
    const items = [card(1, 'One'), card(2, 'Two'), card(3, 'Three')];
    const reply = (groups) => ({groups: groups.map(cards => ({cards, same: 'the fact'}))});
    // the first reader is asked with no model, the second with deepseek reasoning: told apart by the options of the call
    const readers = (first, second) => ollamaJson.mockImplementation(async (prompt, usage, options = {}) => {
        const answer = options.model ? second : first;
        if (answer instanceof Error) throw answer;
        return answer;
    });

    it('should give the groups both readers agree on, the second reader being deepseek with reasoning and no other model to fall back to', async () => {
        readers(reply([[1, 2], [1, 3]]), reply([[1, 2]]));
        const log = quiet();
        const groups = await sameNewsGroups(items, 'en', {label: 8, log});
        expect(groups).toEqual([[0, 1]]);
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        const [first, second] = ollamaJson.mock.calls.map(call => call[2] ?? {});
        expect(first.model).toBeUndefined();
        expect(second).toMatchObject({model: MERGE_MODEL, think: true, fallback: null});
        expect(log.log.mock.calls[0][0]).toMatch(/Briefing 8: same news: 2 groups by the first reader, 1 by the second, 1 agreed/);
    });

    it('should fold nothing on the word of one reader, nor when one does not answer', async () => {
        readers(reply([[1, 2]]), reply([]));
        expect(await sameNewsGroups(items, 'en', {log: quiet()})).toEqual([]);
        readers(reply([[1, 2]]), new Error('402 payment required'));
        const log = quiet();
        expect(await sameNewsGroups(items, 'en', {label: 3, log})).toEqual([]);
        expect(log.error.mock.calls[0][0]).toMatch(/Briefing 3: same news: the second reader did not answer \(402 payment required\), no card is folded/);
        readers(new Error('down'), reply([[1, 2]]));
        expect(await sameNewsGroups(items, 'en', {log: quiet()})).toEqual([]);
    });

    it('should never fail, and give nothing for an answer that cannot be read', async () => {
        readers('nonsense', null);
        expect(await sameNewsGroups(items, 'en', {log: quiet()})).toEqual([]);
        ollamaJson.mockImplementation(() => { throw new Error('sync failure'); });
        expect(await sameNewsGroups(items, 'en', {log: quiet()})).toEqual([]);
    });

    it('should ask nothing for one card, nor when it is switched off', async () => {
        expect(await sameNewsGroups([card(1, 'Alone')], 'en', {log: quiet()})).toEqual([]);
        process.env.AI_CARD_MERGE = 'off';
        try {
            expect(await sameNewsGroups(items, 'en', {log: quiet()})).toEqual([]);
        } finally {
            delete process.env.AI_CARD_MERGE;
        }
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should count the tokens of both calls in the usage it is given', async () => {
        const usage = {calls: 0, input: 0, output: 0};
        ollamaJson.mockImplementation(async (prompt, counted) => {
            counted.calls += 1;
            counted.output += 10;
            return reply([]);
        });
        await sameNewsGroups(items, 'en', {usage, log: quiet()});
        expect(usage).toEqual({calls: 2, input: 0, output: 20});
    });
});
