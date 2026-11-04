//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: test.affair.js
//  Description: The affair of a card: its events in time order (a fact told in several languages is one), the marks
//               "reported", "official" and "denial", how widely the media told it, and what the code keeps of the
//               AI's answers
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn()}));
const {datedAt, eventsOf, factsOf, isKey, joinedEvents, marksOf, reportedBy} = await import('../../services/utils/affair-events.js');
const {coverageOf} = await import('../../services/utils/affair-coverage.js');
const {normalizeFile, normalizeJudged, normalizeSame} = await import('../../services/utils/affair-judge.js');

const HOUR = 3600e3;
const news = (title, medium, at, extra = {}) => ({title, description: '', medium, lang: 'en', link: `https://${medium}/${title}`, at, ...extra});
const story = (storyId, items, lang = 'en') => ({storyId, lang, news: items, media: [...new Set(items.map(item => item.medium))]});

describe('datedAt', () => {
    const created = new Date('2026-11-02T10:00:00Z');

    it('should keep the date of the feed when it is near the day we saw the story', () => {
        expect(datedAt('2026-11-02T08:00:00Z', created)).toEqual(new Date('2026-11-02T08:00:00Z'));
    });

    it('should take the day we saw it for a page re-dated long before or dated in the future', () => {
        expect(datedAt('2026-09-01T08:00:00Z', created)).toEqual(created);
        expect(datedAt('2026-11-09T08:00:00Z', created)).toEqual(created);
        expect(datedAt(null, created)).toEqual(created);
        expect(datedAt('not a date', created)).toEqual(created);
    });
});

describe('factsOf', () => {
    const at = (hours) => +new Date('2026-11-01T00:00:00Z') + hours * HOUR;

    it('should join a story to the one the AI says it repeats when their vectors agree', () => {
        const stories = [{storyId: 1, at: at(0), as: null}, {storyId: 2, at: at(2), as: 1}, {storyId: 3, at: at(3), as: null}];
        expect(factsOf(stories, () => 0.9)).toEqual([[1, 2], [3]]);
    });

    it('should not join two steps of one affair the vectors keep apart, nor two days far apart', () => {
        const stories = [{storyId: 1, at: at(0), as: null}, {storyId: 2, at: at(2), as: 1}];
        expect(factsOf(stories, () => 0.7)).toEqual([[1], [2]]);
        expect(factsOf([{storyId: 1, at: at(0), as: null}, {storyId: 2, at: at(24 * 5), as: 1}], () => 0.95)).toEqual([[1], [2]]);
    });

    it('should not join a denial to what it denies, whatever the AI says', () => {
        const stories = [{storyId: 1, at: at(0), as: null}, {storyId: 2, at: at(20), as: 1, denial: true}];
        expect(factsOf(stories, () => 0.9)).toEqual([[1], [2]]);
        expect(factsOf([{storyId: 1, at: at(0), as: null, denial: true}, {storyId: 2, at: at(20), as: 1, denial: true}], () => 0.9)).toEqual([[1, 2]]);
    });

    it('should chain: a story repeating one that repeats another', () => {
        const stories = [{storyId: 1, at: at(0), as: null}, {storyId: 2, at: at(1), as: 1}, {storyId: 3, at: at(2), as: 2}];
        expect(factsOf(stories, () => 0.9)).toEqual([[1, 2, 3]]);
    });
});

describe('marks', () => {
    it('should call a fact reported when half of its news hedge, or any of two or fewer', () => {
        const hedged = (title) => ({title, description: ''});
        expect(reportedBy([hedged('X reportedly resigns')])).toBe('reportedly');
        expect(reportedBy([hedged('X reportedly resigns'), hedged('X resigns'), hedged('X resigns, says FIFA'), hedged('X resigns now')])).toBeNull();
        expect(reportedBy([hedged('X reportedly resigns'), hedged('X reportedly quits'), hedged('X goes')])).toBe('reportedly');
    });

    it('should believe the AI on a denial or an official statement only when the words say it too', () => {
        const items = [{title: 'FIFA denies the report', description: '', lang: 'en'}];
        expect(marksOf(items, ['denial']).denial).toBe(true);
        expect(marksOf([{title: 'FIFA lifts the ban', description: '', lang: 'en'}], ['denial']).denial).toBe(false);
        expect(marksOf([{title: 'UEFA says in a statement it will appeal', description: '', lang: 'en'}], ['official']).official).toBe(true);
        expect(marksOf([{title: 'UEFA will appeal, journalists say', description: '', lang: 'en'}], ['official']).official).toBe(false);
        expect(marksOf(items, []).denial).toBe(false);
    });

    it('should not call a denial reported: it speaks of the rumour it denies', () => {
        const items = [{title: 'Dell denies the rumour of an Everton takeover', description: '', lang: 'en'}];
        expect(marksOf(items, ['denial'])).toEqual({reported: null, official: false, denial: true});
    });

    it('should make an event key only when two media tell it, or the party announces or denies it', () => {
        expect(isKey('key', 1, {})).toBe(false);
        expect(isKey('key', 2, {})).toBe(true);
        expect(isKey('key', 1, {official: true})).toBe(true);
        expect(isKey('minor', 30, {official: true})).toBe(false);
    });
});

describe('eventsOf', () => {
    const verdict = (extra = {}) => ({in: true, kind: 'key', as: null, says: null, ...extra});
    const likeness = () => 0.9;

    it('should make one event of a fact told in two languages, led by the story in the language of the reader', () => {
        const first = story(1, [news('FIFA paid the taxes', 'nytimes.com', '2026-11-02T05:00:00Z')]);
        const second = story(2, [news('La FIFA a payé les impôts', 'lemonde.fr', '2026-11-02T06:00:00Z', {lang: 'fr'})], 'fr');
        const events = eventsOf([
            {story: first, verdict: verdict(), at: new Date('2026-11-02T05:00:00Z'), asStory: null},
            {story: second, verdict: verdict(), at: new Date('2026-11-02T06:00:00Z'), asStory: 1},
        ], {language: 'fr', likeness});
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({id: 2, storyIds: [1, 2], title: 'La FIFA a payé les impôts', language: 'fr', languages: ['en', 'fr'], kind: 'key'});
        expect(events[0].media.sort()).toEqual(['lemonde.fr', 'nytimes.com']);
        expect(events[0].at).toBe('2026-11-02T05:00:00.000Z');
    });

    it('should put the events in time order and demote the key event of a single medium', () => {
        const events = eventsOf([
            {story: story(2, [news('Second', 'b.com', '2026-11-03T00:00:00Z')]), verdict: verdict(), at: new Date('2026-11-03T00:00:00Z'), asStory: null},
            {story: story(1, [news('First', 'a.com', '2026-11-01T00:00:00Z')]), verdict: verdict({kind: 'minor'}), at: new Date('2026-11-01T00:00:00Z'), asStory: null},
        ], {language: 'en', likeness});
        expect(events.map(event => event.title)).toEqual(['First', 'Second']);
        expect(events.map(event => event.kind)).toEqual(['minor', 'minor']);
        expect(events[1].aiKey).toBe(true);
    });
});

describe('joinedEvents', () => {
    const event = (id, at, media, extra = {}) => ({id, storyIds: [id], at, kind: 'minor', aiKey: true, language: 'en', media, news: media.length, languages: ['en'], reported: null, official: false, denial: false, title: `E${id}`, ...extra});

    it('should join the events the AI says tell one fact and make the joined one key once two media tell it', () => {
        const joined = joinedEvents([event(1, '2026-11-02T05:00:00Z', ['a.com']), event(2, '2026-11-02T09:00:00Z', ['b.com']), event(3, '2026-11-04T00:00:00Z', ['c.com'])], [[0, 1]], 'en');
        expect(joined.map(item => item.storyIds)).toEqual([[1, 2], [3]]);
        expect(joined[0]).toMatchObject({kind: 'key', news: 2, at: '2026-11-02T05:00:00Z'});
        expect(joined[0].media.sort()).toEqual(['a.com', 'b.com']);
    });

    it('should leave alone a denial and the event it denies', () => {
        const joined = joinedEvents([event(1, '2026-11-02T05:00:00Z', ['a.com']), event(2, '2026-11-02T09:00:00Z', ['b.com'], {denial: true})], [[0, 1]], 'en');
        expect(joined).toHaveLength(2);
    });

    it('should leave alone the events of a group more than three days apart', () => {
        const joined = joinedEvents([event(1, '2026-11-01T00:00:00Z', ['a.com']), event(2, '2026-11-09T00:00:00Z', ['b.com'])], [[0, 1]], 'en');
        expect(joined).toHaveLength(2);
    });
});

describe('coverageOf', () => {
    const now = new Date('2026-11-05T00:00:00Z');

    it('should count the media, the news, the first to tell it and the media of each day', () => {
        const coverage = coverageOf([
            story(1, [news('a', 'nytimes.com', '2026-11-01T10:00:00Z'), news('b', 'bbc.co.uk', '2026-11-01T12:00:00Z'), news('c', 'nytimes.com', '2026-11-03T12:00:00Z')]),
            story(2, [news('d', 'lemonde.fr', '2026-11-03T08:00:00Z', {lang: 'fr'})], 'fr'),
        ], now);
        // two days tie at 2 media: the first stands
        expect(coverage).toMatchObject({media: 3, news: 4, first: {medium: 'nytimes.com'}, peak: {day: '2026-11-01', media: 2}});
        expect(coverage.days).toEqual([{day: '2026-11-01', media: 2, news: 2}, {day: '2026-11-02', media: 0, news: 0}, {day: '2026-11-03', media: 2, news: 2}]);
        expect(coverage.languages[0]).toEqual({language: 'en', media: 2, news: 3});
        expect(coverage.byMedium.map(one => one.medium)).toEqual(['nytimes.com', 'bbc.co.uk', 'lemonde.fr']);
    });

    it('should count a link once and leave out a news dated in the future', () => {
        const coverage = coverageOf([
            story(1, [news('a', 'a.com', '2026-11-01T10:00:00Z')]),
            story(2, [news('a', 'a.com', '2026-11-01T10:00:00Z'), news('future', 'b.com', '2026-12-01T10:00:00Z')]),
        ], now);
        expect(coverage.news).toBe(1);
        expect(coverage.media).toBe(1);
    });

    it('should answer an empty coverage for an affair without news', () => {
        expect(coverageOf([], now)).toMatchObject({media: 0, news: 0, first: null, days: []});
    });
});

describe('what the code keeps of the AI', () => {
    it('should keep the title of an affair only if its names are in the news it was written from', () => {
        const facts = [{title: 'UEFA writes to FIFA about Infantino'}];
        expect(normalizeFile({affair: true, title: 'UEFA pressure on Infantino and FIFA', about: 'a', not: 'b'}, 'UEFA awaits answers', facts))
            .toMatchObject({title: 'UEFA pressure on Infantino and FIFA', written: true});
        expect(normalizeFile({affair: true, title: 'UEFA pressure on Infantino and Blatter', about: 'a', not: 'b'}, 'UEFA awaits answers', facts))
            .toMatchObject({title: 'UEFA awaits answers', written: false});
    });

    it('should answer nothing for what the AI says is no affair', () => {
        expect(normalizeFile({affair: false}, 'Title', [])).toBeNull();
        expect(normalizeFile(null, 'Title', [])).toBeNull();
    });

    it('should keep "as" only for an earlier story judged in, and a story the AI did not answer is out', () => {
        const items = [{}, {}, {}, {}];
        const verdicts = normalizeJudged({news: [
            {n: 1, in: true, kind: 'key'},
            {n: 2, in: false, kind: 'key'},
            {n: 3, in: true, kind: 'minor', as: 2},
            {n: 4, in: true, kind: 'minor', as: 1, says: 'denial'},
        ]}, items);
        expect(verdicts.map(verdict => verdict.in)).toEqual([true, false, true, true]);
        expect(verdicts.map(verdict => verdict.as)).toEqual([null, null, null, 0]);
        expect(verdicts[3].says).toBe('denial');
        expect(normalizeJudged({news: [{n: 1, in: true}]}, items).map(verdict => verdict.in)).toEqual([true, false, false, false]);
        expect(normalizeJudged(null, items).every(verdict => !verdict.in)).toBe(true);
    });

    it('should keep groups of two events or more, each event once', () => {
        expect(normalizeSame({same: [[3, 4], [4, 5], [1], [9, 2], 'x']}, 5)).toEqual([[2, 3]]);
        expect(normalizeSame({same: [[1, 2, 2]]}, 5)).toEqual([[0, 1]]);
        expect(normalizeSame(null, 5)).toEqual([]);
    });
});
