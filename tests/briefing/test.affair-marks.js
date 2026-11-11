//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.affair-marks.js
//  Description: The marks of an event of an affair (Official, Contested, Reported) decided by the AI that reads the event: the news it is shown,
//               what each mark needs, what is asked again, and what the reader is given when the AI never answered (the user, 11.11.2026: the three
//               badges showed on 3.7, 0.3 and 0.8 events in 100 and were right when they showed; an AI that reads the text finds 4 to 6 times more)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {markEvents, needsMarks, shownNews, withShownMarks, MARKS_AT_ONCE, SHOWN_NEWS} = await import('../../services/utils/affair-marks.js');

const news = (title, medium, extra = {}) => ({title, description: '', medium, lang: 'en', ...extra});
const event = (id, extra = {}) => ({id, storyIds: [id], at: '2026-11-04T10:00:00.000Z', title: `Event ${id}`, language: 'en', media: ['a.com'], news: 3, languages: ['en'],
    reported: null, official: false, denial: false, ...extra});
// the AI, as the prompt asks it: the marks it is told to give, by the number of the event in the call
const ai = (answers) => ollamaJson.mockImplementation(async (prompt) => {
    const ids = [...prompt.matchAll(/^\[(\d+)\] /gm)].map(match => Number(match[1]));
    return {events: ids.map(id => ({id, official: false, contested: false, reported: false, ...(answers[id] ?? {})}))};
});
const newsOf = (table) => (one) => table[one.id] ?? [news(`headline ${one.id}`, 'a.com')];

beforeEach(() => ollamaJson.mockReset());

describe('shownNews', () => {
    it('should show the news a word fired on first, then the ones of other media, eight at most', () => {
        const items = [
            ...Array.from({length: 10}, (_, i) => news(`plain ${i}`, 'wire.com')),
            news('The club said in a statement that it will appeal', 'b.com'),
            news('Mbappe reportedly wants to leave', 'c.com'),
            news('Other medium, other title', 'd.com'),
        ];
        const shown = shownNews(items);
        expect(shown).toHaveLength(SHOWN_NEWS);
        expect(shown.slice(0, 2).map(item => item.medium)).toEqual(['b.com', 'c.com']);
        expect(shown.some(item => item.medium === 'd.com')).toBe(true);
    });

    it('should cut the text of a news to its beginning, with no tag of a page', () => {
        const [shownOne] = shownNews([news('A title', 'a.com', {description: `<p>${'word '.repeat(200)}</p>`})]);
        expect(shownOne.description.length).toBeLessThanOrEqual(241);
        expect(shownOne.description).not.toContain('<');
    });
});

describe('markEvents', () => {
    it('should take Contested from the AI alone, and Official from the AI and the words of a statement or a communiqué in some news', async () => {
        ai({1: {official: true}, 2: {contested: true}, 3: {official: true}, 4: {official: false}});
        const marked = await markEvents([event(1), event(2), event(3), event(4)], newsOf({
            1: [news('The president speaks to the press', 'a.com')],
            3: [news('The club said in a statement that it will appeal', 'a.com')],
            4: [news('The club said in a statement that it will appeal', 'a.com')],
        }));
        expect(marked.map(one => [one.marks.official, one.marks.contested])).toEqual([[false, false], [false, true], [true, false], [false, false]]);
        expect(marked[0].marks).toEqual({official: false, contested: false, reported: null, news: 3});
    });

    it('should give Reported only when the AI says it and a news of the event holds a hedge, with the words it hedges with', async () => {
        ai({1: {reported: true}, 2: {reported: true}, 3: {reported: false}});
        const marked = await markEvents([event(1), event(2), event(3)], newsOf({
            1: [news('Mbappe reportedly agreed terms', 'a.com'), news('Mbappe signs', 'b.com'), news('Mbappe signs', 'c.com')],
            2: [news('The tax bill was paid', 'a.com'), news('The tax bill was paid', 'b.com')],
            3: [news('Mbappe reportedly agreed terms', 'a.com')],
        }));
        expect(marked.map(one => one.marks.reported)).toEqual(['reportedly', null, null]);
    });

    it('should ask six events in a call and read the answers by the number of the event in the call', async () => {
        ai({});
        const events = Array.from({length: MARKS_AT_ONCE + 2}, (_, i) => event(i + 1));
        await markEvents(events, newsOf({}));
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        const [first, second] = ollamaJson.mock.calls.map(call => call[0]);
        expect([...first.matchAll(/^\[(\d+)\] /gm)].map(match => match[1])).toEqual(['1', '2', '3', '4', '5', '6']);
        expect([...second.matchAll(/^\[(\d+)\] /gm)].map(match => match[1])).toEqual(['1', '2']);
        expect(second).toContain('Event 7');
        expect(second).not.toContain('Event 1 ');
    });

    it('should show the AI the title of the event and the beginning of its news, in their language', async () => {
        ai({});
        await markEvents([event(1, {title: 'Infantino dément', titleTranslation: 'Infantino denies'})], newsOf({
            1: [news('FIFA dément', 'lemonde.fr', {lang: 'fr', description: 'Le président de la FIFA dément les accusations.'})]}));
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('Infantino denies');
        expect(prompt).toContain('(fr, lemonde.fr) FIFA dément');
        expect(prompt).toContain('Le président de la FIFA dément les accusations.');
    });

    it('should leave an event with no news unmarked, and never fail when the AI does', async () => {
        ollamaJson.mockRejectedValue(new Error('the AI is down'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const marked = await markEvents([event(1), event(2)], (one) => one.id === 2 ? [] : [news('A headline', 'a.com')]);
        expect(marked.map(one => one.marks)).toEqual([undefined, undefined]);
        expect(console.error).toHaveBeenCalled();
    });

    it('should ignore an answer for an event that was not asked, and leave unmarked the one it did not answer', async () => {
        ollamaJson.mockResolvedValue({events: [{id: 1, contested: true}, {id: 99, contested: true}]});
        const marked = await markEvents([event(1), event(2)], newsOf({}));
        expect(marked[0].marks.contested).toBe(true);
        expect(marked[1].marks).toBeUndefined();
    });

    it('should not ask again for the events that have their marks, unless they are told to or their news doubled', async () => {
        ai({});
        const marks = {official: false, contested: false, reported: null, news: 3};
        const kept = event(1, {marks});
        const touched = event(2, {marks});
        const grown = event(3, {marks, news: 7});
        expect([kept, touched, grown, event(4)].map(one => needsMarks(one, new Set([2])))).toEqual([false, true, true, true]);
        await markEvents([kept, touched, grown, event(4)], newsOf({}), {again: new Set([2])});
        expect(ollamaJson.mock.calls[0][0]).not.toContain('Event 1');
        expect(ollamaJson.mock.calls[0][0]).toContain('Event 4');
    });

    it('should not change the events it was given, nor the structure the watch counts on', async () => {
        ai({1: {official: true, contested: true}});
        const original = event(1, {denial: false, official: false});
        const [marked] = await markEvents([original], newsOf({1: [news('The federation issued a statement', 'a.com')]}));
        expect(original.marks).toBeUndefined();
        expect(marked).toMatchObject({denial: false, official: false, marks: {official: true, contested: true}});
    });
});

describe('withShownMarks', () => {
    it('should give the marks of the AI to the fields the page and the e-mail read, and keep the ones of the words for an event with none', () => {
        const shown = withShownMarks([
            event(1, {marks: {official: true, contested: true, reported: 'reportedly', news: 3}, denial: false, official: false}),
            event(2, {official: true, denial: false, reported: 'rumour'}),
        ]);
        expect(shown[0]).toMatchObject({official: true, denial: true, reported: 'reportedly'});
        expect(shown[1]).toMatchObject({official: true, denial: false, reported: 'rumour'});
    });

    it('should not change the events it is given', () => {
        const original = event(1, {marks: {official: true, contested: false, reported: null, news: 3}});
        withShownMarks([original]);
        expect(original.official).toBe(false);
    });
});
