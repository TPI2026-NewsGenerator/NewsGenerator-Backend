//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.sent-repeats.js
//  Description: A card that tells the news of a card the reader got by e-mail does not come back (sent-repeats.js): the candidates (a story shared, a
//               reader of the list), the strict look at each pair, the affairs followed, and that nothing is left out on a doubt
//
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {closePairs, listPrompt, lookPrompt, normalizeLook, normalizeRepeats, receivedCards, repeatedCards, sharedPairs, viewOf, withoutSentRepeats} = await import('../../services/utils/sent-repeats.js');
const {ORIGINAL_START, ORIGINAL_END} = await import('../../services/utils/original-marks.js');

const item = (storyId, title, changes = {}) => ({
    storyId, title, mergedStoryIds: [], summary: `${title} is told in a first sentence.\n\nA second paragraph.\n\nA third.\n\nA fourth.`,
    lead: {source: `media${storyId}.example`}, corroboration: {media: 3}, ...changes,
});
const row = (storyId, title, shownAt = '2026-11-11T08:00:00Z', changes = {}) => ({storyId, mergedStoryIds: [], title, text: `${title} was sent.`, source: 'sent.example', media: 2, shownAt, ...changes});
const quiet = () => ({log: jest.fn(), error: jest.fn()});
// the reader of the list is asked "A reader already received...", the look "A reader received Card A..."
const ai = ({repeats = [], verdict = 'SAME', reader, look} = {}) => ollamaJson.mockImplementation(async (prompt) => {
    const kind = prompt.startsWith('A reader already received') ? reader : look;
    if (kind instanceof Error) throw kind;
    if (kind !== undefined) return kind;
    return prompt.startsWith('A reader already received') ? {repeats} : {verdict, why: 'x'};
});

beforeEach(() => ollamaJson.mockReset());

describe('receivedCards', () => {
    it('should keep one card per story, the last time it was sent, the oldest first', () => {
        const cards = receivedCards([row(1, 'First', '2026-11-10T08:00:00Z'), row(2, 'Second', '2026-11-11T08:00:00Z'), row(1, 'First again', '2026-11-11T09:00:00Z')]);
        expect(cards.map(card => card.title)).toEqual(['Second', 'First again']);
    });

    it('should leave out a card the reader added (a negative id) and keep the stories joined to a card', () => {
        const cards = receivedCards([row(-4, 'Added'), row(7, 'Joined', undefined, {mergedStoryIds: [8, 9]})]);
        expect(cards).toHaveLength(1);
        expect([...cards[0].ids].sort()).toEqual([7, 8, 9]);
    });

    it('should keep every card sent, however old, the oldest first', () => {
        const rows = Array.from({length: 90}, (_, i) => row(i + 1, `Card ${i + 1}`, new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString()));
        const cards = receivedCards(rows.reverse());
        expect(cards).toHaveLength(90);
        expect(cards[0].title).toBe('Card 1');
        expect(cards.at(-1).title).toBe('Card 90');
    });
});

describe('the prompts', () => {
    it('should number the cards received R and the cards of today T, in the language of the reader', () => {
        const prompt = listPrompt([viewOf(item(1, 'Today one'))], receivedCards([row(5, 'Sent one')]), 'fr');
        expect(prompt).toContain('The reader reads in French.');
        expect(prompt).toContain('[R1] Sent one\n    Sent one was sent.');
        expect(prompt).toContain('[T1] Today one\n    Today one is told in a first sentence.');
        expect(prompt).toContain('When in doubt, do not group.');
    });

    it('should show the look the first three paragraphs of each card without the marks of the translation', () => {
        const card = viewOf(item(1, 'Today', {translation: `${ORIGINAL_START}(Un.)${ORIGINAL_END} Deux.\n\nTrois.\n\nQuatre.\n\nCinq.`}));
        const prompt = lookPrompt(receivedCards([row(5, 'Sent')])[0], card);
        expect(prompt).toContain('Card A: Sent (sent.example, 2 media)\nSent was sent.');
        expect(prompt).toContain('(Un.) Deux.\nTrois.\nQuatre.');
        expect(prompt).not.toContain('Cinq.');
        expect(prompt).toContain('Be strict');
    });
});

describe('normalizeRepeats', () => {
    it('should read the numbers with or without their letter and keep the pairs of the lists, from zero', () => {
        expect(normalizeRepeats({repeats: [{today: 'T2', received: 'R1'}, {today: 3, received: '2'}, {today: 9, received: 1}, {today: 1, received: 0}, null, {today: 'T1'}]}, 4, 2)).toEqual([[1, 0], [2, 1]]);
    });

    it('should give nothing for an answer that is not a list', () => {
        for (const answer of [null, 'yes', {repeats: 'no'}, {groups: []}, []]) expect(normalizeRepeats(answer, 3, 3)).toEqual([]);
    });
});

describe('closePairs', () => {
    it('should pair the card of today holding a story with the card sent holding the other, the closest first, once', () => {
        const today = [viewOf(item(1, 'A')), viewOf(item(2, 'B', {mergedStoryIds: [60]}))];
        const received = receivedCards([row(50, 'Sent one'), row(51, 'Sent two', undefined, {mergedStoryIds: [70]})]);
        const rows = [{a: 50, b: 2, likeness: 0.74}, {a: 50, b: 60, likeness: 0.81}, {a: 70, b: 1, likeness: 0.72}, {a: 999, b: 1, likeness: 0.9}, {a: 51, b: 888, likeness: 0.9}];
        expect(closePairs(today, received, rows)).toEqual([[1, 0, 0.81], [0, 1, 0.72]]);
    });
});

describe('sharedPairs and normalizeLook', () => {
    it('should pair the cards sharing a story, their own or one joined to them', () => {
        const today = [viewOf(item(1, 'A')), viewOf(item(2, 'B', {mergedStoryIds: [50]})), viewOf(item(3, 'C'))];
        const received = receivedCards([row(50, 'Sent'), row(9, 'Other')]);
        expect(sharedPairs(today, received)).toEqual([[1, 0]]);
    });

    it('should read the verdict whatever its case and nothing else', () => {
        expect(normalizeLook({verdict: ' same '})).toBe('SAME');
        expect(normalizeLook({verdict: 'DEVELOPMENT'})).toBe('DEVELOPMENT');
        for (const answer of [null, {verdict: 'maybe'}, {same: true}, 'SAME']) expect(normalizeLook(answer)).toBeNull();
    });
});

describe('repeatedCards', () => {
    const items = [item(1, 'Wenger considers a bid'), item(2, 'Other news'), item(3, 'Tashima enters the race')];
    const received = receivedCards([row(20, 'Wenger weighs a run'), row(21, 'Tashima is a candidate')]);

    it('should leave out a card the reader pairs with a card sent and the look calls the same news', async () => {
        ai({repeats: [{today: 1, received: 1}]});
        const log = quiet();
        const left = await repeatedCards(items, received, 'en', {label: 9, log});
        expect(left).toEqual([{index: 0, storyId: 1, title: 'Wenger considers a bid', earlier: {title: 'Wenger weighs a run', shownAt: new Date('2026-11-11T08:00:00Z')}}]);
        expect(log.log.mock.calls[0][0]).toMatch(/Briefing 9: sent repeats: 0 cards share a story with a card sent, 1 pairs by the reader, 0 close in the vectors, 1 looked at, 1 left out/);
    });

    it('should keep a card the look calls a development, the evolution the reader came for', async () => {
        ai({repeats: [{today: 3, received: 2}], verdict: 'DEVELOPMENT'});
        expect(await repeatedCards(items, received, 'en', {log: quiet()})).toEqual([]);
    });

    it('should look at a card that shares a story with a card sent even when the reader of the list gives nothing', async () => {
        const joined = [item(1, 'Wenger again', {mergedStoryIds: [20]})];
        ai({repeats: []});
        const left = await repeatedCards(joined, received, 'en', {log: quiet()});
        expect(left.map(one => one.storyId)).toEqual([1]);
        expect(ollamaJson.mock.calls.filter(call => call[0].startsWith('A reader received Card A'))).toHaveLength(1);
    });

    it('should never leave out a card of an affair the reader follows, nor ask about it', async () => {
        ai({repeats: [{today: 1, received: 1}]});
        const left = await repeatedCards(items, received, 'en', {log: quiet(), followed: new Set([1])});
        expect(left).toEqual([]);
        expect(ollamaJson.mock.calls.filter(call => call[0].startsWith('A reader received Card A'))).toHaveLength(0);
    });

    it('should ask the look with reasoning, on the model of the briefing unless another is chosen', async () => {
        ai({repeats: [{today: 1, received: 1}]});
        await repeatedCards(items, received, 'en', {log: quiet()});
        const [reader, look] = ollamaJson.mock.calls.map(call => call[2] ?? {});
        expect(reader.think).toBeUndefined();
        expect(look).toMatchObject({think: true});
        expect(look.model).toBeUndefined();
        process.env.OLLAMA_REPEAT_MODEL = 'other-model';
        try {
            ollamaJson.mockClear();
            await repeatedCards(items, received, 'en', {log: quiet()});
            expect(ollamaJson.mock.calls.map(call => call[2] ?? {})[1]).toMatchObject({model: 'other-model', think: true, fallback: null});
        } finally {
            delete process.env.OLLAMA_REPEAT_MODEL;
        }
    });

    it('should look only at the stories shared when the reader of the list fails, and say so', async () => {
        ai({reader: new Error('429 too many requests')});
        const log = quiet();
        const left = await repeatedCards([item(1, 'Wenger again', {mergedStoryIds: [20]}), item(2, 'Other news')], received, 'en', {label: 4, log});
        expect(left.map(one => one.storyId)).toEqual([1]);
        expect(log.error.mock.calls[0][0]).toMatch(/Briefing 4: sent repeats: the reader of the list did not answer \(429 too many requests\)/);
    });

    it('should look at a card the stories say is close to a card sent, even when the reader of the list gives nothing', async () => {
        ai({repeats: []});
        const left = await repeatedCards(items, received, 'en', {log: quiet(), close: [{a: 21, b: 3, likeness: 0.78}]});
        expect(left.map(one => [one.storyId, one.earlier.title])).toEqual([[3, 'Tashima is a candidate']]);
    });

    it('should show the reader of the list the newest 80 cards sent only, and keep the others for the look', async () => {
        const many = receivedCards(Array.from({length: 90}, (_, i) => row(i + 1, `Card ${i + 1}`, new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString())));
        ai({repeats: [{today: 1, received: 1}]});
        const left = await repeatedCards([item(500, 'Today')], many, 'en', {log: quiet(), close: [{a: 2, b: 500, likeness: 0.7}]});
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('[R80] Card 90');
        expect(prompt).not.toContain('[R81]');
        expect(prompt).toContain('[R1] Card 11');
        expect(prompt).not.toContain('] Card 10 ');
        // the reader's first card is the 11th sent: the pair it gives is [today, 11th]; the pair of the vectors is [today, 2nd], asked after it
        expect(left[0].earlier.title).toBe('Card 11');
        expect(ollamaJson.mock.calls.filter(call => call[0].startsWith('A reader received Card A'))[0][0]).toContain('Card A: Card 11 ');
    });

    it('should keep every card when a look is not answered, or says anything but the same news', async () => {
        ai({repeats: [{today: 1, received: 1}, {today: 3, received: 2}], look: new Error('timeout')});
        expect(await repeatedCards(items, received, 'en', {log: quiet()})).toEqual([]);
        ai({repeats: [{today: 1, received: 1}], look: {verdict: 'maybe'}});
        expect(await repeatedCards(items, received, 'en', {log: quiet()})).toEqual([]);
        ai({repeats: [{today: 1, received: 1}], verdict: 'DIFFERENT'});
        expect(await repeatedCards(items, received, 'en', {log: quiet()})).toEqual([]);
    });

    it('should never fail, and leave out nothing when the AI cannot be asked', async () => {
        ollamaJson.mockImplementation(() => { throw new Error('sync failure'); });
        expect(await repeatedCards([item(1, 'Wenger again', {mergedStoryIds: [20]})], received, 'en', {log: quiet()})).toEqual([]);
    });

    it('should ask nothing when no card was sent, for no card, or when it is switched off', async () => {
        expect(await repeatedCards(items, [], 'en', {log: quiet()})).toEqual([]);
        expect(await repeatedCards([], received, 'en', {log: quiet()})).toEqual([]);
        process.env.AI_SENT_REPEATS = 'off';
        try {
            expect(await repeatedCards(items, received, 'en', {log: quiet()})).toEqual([]);
        } finally {
            delete process.env.AI_SENT_REPEATS;
        }
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should look at no more than twenty pairs', async () => {
        const many = Array.from({length: 20}, (_, i) => item(100 + i, `Card ${i}`, {mergedStoryIds: [20]}));
        ai({repeats: []});
        await repeatedCards(many, received, 'en', {log: quiet()});
        expect(ollamaJson.mock.calls.filter(call => call[0].startsWith('A reader received Card A'))).toHaveLength(20);
    });

    it('should count the tokens of every call in the usage it is given', async () => {
        const usage = {calls: 0, input: 0, output: 0};
        ollamaJson.mockImplementation(async (prompt, counted) => {
            counted.calls += 1;
            return prompt.startsWith('A reader already received') ? {repeats: [{today: 1, received: 1}]} : {verdict: 'SAME'};
        });
        await repeatedCards(items, received, 'en', {usage, log: quiet()});
        expect(usage.calls).toBe(2);
    });
});

describe('withoutSentRepeats', () => {
    it('should take out the cards of the stories left out, say which in the log, and keep the others as they are', () => {
        const cards = [item(1, 'Kept'), item(2, 'Repeat'), item(3, 'Kept too')];
        const log = quiet();
        const done = withoutSentRepeats(cards, [{index: 1, storyId: 2, title: 'Repeat', earlier: {title: 'Sent title', shownAt: new Date('2026-11-11T08:00:00Z')}}], {label: 12, log});
        expect(done.map(card => card.storyId)).toEqual([1, 3]);
        expect(log.log.mock.calls[0][0]).toBe('Briefing 12: sent repeats: "Repeat" is left out, it tells the news of "Sent title" sent on 2026-11-11');
    });

    it('should give the same cards when none repeats', () => {
        const cards = [item(1, 'Kept')];
        expect(withoutSentRepeats(cards, [])).toBe(cards);
    });
});
