//
//  Author: Fabian Rostello
//  Date: 04.11.2026
//  File: test.affair-watch.js
//  Description: The check of a followed affair: the new stories judged against its file, joined to the events the reader
//               has, a key event rung only when the second opinion says so, never twice, and what the push says
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../models/affair-model.js', () => ({AffairModel: {}}));
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {likenessAmong: async () => []}}));
jest.unstable_mockModule('../../services/utils/affair-names.js', () => ({AFFAIR_DAYS: 30, storiesOfSameNames: async () => new Map()}));
const {checkAffair} = await import('../../services/utils/affair-watch.js');
const {mergedNew, refreshedEvent} = await import('../../services/utils/affair-events.js');
const {mergedCoverage} = await import('../../services/utils/affair-coverage.js');
const {normalizeConfirmed} = await import('../../services/utils/affair-judge.js');
jest.unstable_mockModule('web-push', () => ({default: {setVapidDetails: () => {}, sendNotification: async () => {}}}));
const {messageOf, subjectOf} = await import('../../services/push-service.js');

const NOW = new Date('2026-11-04T12:00:00Z');
const at = (hours) => new Date(+NOW - hours * 3600e3);

const news = (title, medium, hours, extra = {}) => ({title, description: '', medium, lang: 'en', link: `https://${medium}/${encodeURIComponent(title)}`, at: at(hours), ...extra});
const story = (storyId, items, hours) => ({storyId, lang: 'en', via: 'fresh', likeness: 0.8, createdAt: at(hours), news: items, media: [...new Set(items.map(item => item.medium))], at: at(hours)});
const event = (id, hours, extra = {}) => ({
    id, storyIds: [id], at: at(hours).toISOString(), kind: 'key', aiKey: true, title: `Event ${id}`, url: `https://a.com/${id}`, medium: 'a.com', language: 'en',
    media: ['a.com', 'b.com'], news: 2, languages: ['en'], reported: null, official: false, denial: false, asked: true, alerted: false, ...extra,
});
const affair = (events) => ({title: 'The affair', language: 'en', about: 'About it.', not_about: 'Not that.', view: {events, coverage: null}});

// the AI, as the prompts ask it: the judge says "in" to every story and "key" to the ones in the list, the same-fact pass
// joins what it is told to, the second opinion rings what it is told to
const ai = ({key = [], same = [], ring = []} = {}) => ollamaJson.mockImplementation(async (prompt) => {
    if (prompt.includes('For each news:')) {
        const count = [...prompt.matchAll(/^\[(\d+)\] \(/gm)].length;
        return {news: Array.from({length: count}, (_, i) => ({n: i + 1, in: true, kind: key.includes(i + 1) ? 'key' : 'minor', as: null, says: null}))};
    }
    if (prompt.includes('List the groups of events')) return {same};
    if (prompt.includes('RIGHT NOW')) return {news: ring.map(n => ({n, notify: true}))};
    throw new Error(`unexpected prompt: ${prompt.slice(0, 60)}`);
});

beforeEach(() => ollamaJson.mockReset());

describe('checkAffair', () => {
    it('should ring a new key event the second opinion lets through, and mark it told', async () => {
        ai({key: [1], ring: [1]});
        const result = await checkAffair({affair: affair([event(1, 48)]), now: NOW,
            fresh: [story(10, [news('UEFA picks its candidate', 'a.com', 2), news('UEFA picks its candidate', 'b.com', 1)], 2)]});
        expect(result.accepted).toBe(1);
        expect(result.alerts.map(alert => alert.id)).toEqual([10]);
        expect(result.events.find(one => one.id === 10)).toMatchObject({kind: 'key', asked: true, alerted: true});
    });

    it('should not ring when the second opinion says no, nor ask again at the next check', async () => {
        ai({key: [1], ring: []});
        const first = await checkAffair({affair: affair([event(1, 48)]), now: NOW,
            fresh: [story(10, [news('A comment on it', 'a.com', 2), news('A comment on it', 'b.com', 1)], 2)]});
        expect(first.alerts).toEqual([]);
        expect(first.events.find(one => one.id === 10)).toMatchObject({asked: true, alerted: false});
        ollamaJson.mockClear();
        const again = await checkAffair({affair: affair(first.events), now: NOW, fresh: []});
        expect(again.alerts).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should never ring a minor event: one medium alone is no key event', async () => {
        ai({key: [1], ring: [1]});
        const result = await checkAffair({affair: affair([event(1, 48)]), now: NOW, fresh: [story(10, [news('A scoop', 'a.com', 1)], 1)]});
        expect(result.events.find(one => one.id === 10)).toMatchObject({kind: 'minor'});
        expect(result.alerts).toEqual([]);
        expect(ollamaJson.mock.calls.some(([prompt]) => prompt.includes('RIGHT NOW'))).toBe(false);
    });

    it('should add a story that tells a known fact to that event instead of making a new one, without ringing', async () => {
        // the events as the AI is shown them: the known event first, then the new one
        ai({key: [1], same: [[1, 2]], ring: [1]});
        const result = await checkAffair({affair: affair([event(1, 5, {media: ['a.com', 'b.com']})]), now: NOW,
            fresh: [story(10, [news('Same fact', 'c.com', 2), news('Same fact', 'd.com', 2)], 2)]});
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({id: 1, storyIds: [1, 10]});
        expect(result.events[0].media.sort()).toEqual(['a.com', 'b.com', 'c.com', 'd.com']);
        expect(result.alerts).toEqual([]);
    });

    it('should ring a minor event when a second medium makes a key event of it', async () => {
        ai({ring: [1]});
        const minor = event(1, 5, {kind: 'minor', media: ['a.com'], news: 1});
        const held = new Map([[1, story(1, [news('Event 1', 'a.com', 5), news('Event 1', 'z.com', 1)], 5)]]);
        const result = await checkAffair({affair: affair([{...minor, asked: false}]), now: NOW, fresh: [], held});
        expect(result.promoted).toBe(1);
        expect(result.alerts.map(alert => alert.id)).toEqual([1]);
        expect(result.events[0].media.sort()).toEqual(['a.com', 'z.com']);
    });

    it('should leave the key events unasked when the second opinion fails, so the next check asks again', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.includes('For each news:')) return {news: [{n: 1, in: true, kind: 'key', as: null, says: null}]};
            if (prompt.includes('RIGHT NOW')) throw new Error('down');
            return {same: []};
        });
        const result = await checkAffair({affair: affair([event(1, 48)]), now: NOW,
            fresh: [story(10, [news('A fact', 'a.com', 2), news('A fact', 'b.com', 1)], 2)]});
        expect(result.alerts).toEqual([]);
        expect(result.events.find(one => one.id === 10).asked).toBeUndefined();
    });

    it('should fail when the judge fails, so nothing is saved and the stories are judged again', async () => {
        ollamaJson.mockRejectedValue(new Error('down'));
        await expect(checkAffair({affair: affair([event(1, 48)]), now: NOW, fresh: [story(10, [news('A', 'a.com', 1)], 1)]})).rejects.toThrow('down');
    });
});

describe('mergedNew', () => {
    it('should not join two known events, nor a fresh event more than three days from the known one', () => {
        const known = [event(1, 100), event(2, 99)];
        const fresh = [event(3, 1, {asked: false})];
        expect(mergedNew(known, fresh, [[0, 1]], 'en').events).toHaveLength(3);
        expect(mergedNew([event(1, 100)], fresh, [[0, 1]], 'en').events).toHaveLength(2);
    });

    it('should join the fresh events that tell one fact among themselves', () => {
        const fresh = [event(3, 3, {media: ['a.com']}), event(4, 2, {media: ['b.com']})];
        const {events, touched} = mergedNew([], fresh, [[0, 1]], 'en');
        expect(events).toHaveLength(1);
        expect(events[0].storyIds.sort()).toEqual([3, 4]);
        expect([...touched]).toHaveLength(1);
    });
});

describe('refreshedEvent', () => {
    it('should add the media that told it since and never take one away', () => {
        const refreshed = refreshedEvent(event(1, 5, {media: ['a.com', 'b.com']}), new Map([[1, story(1, [news('x', 'c.com', 1)], 5)]]));
        expect(refreshed.media.sort()).toEqual(['a.com', 'b.com', 'c.com']);
        expect(refreshedEvent(event(1, 5), new Map())).toMatchObject({media: ['a.com', 'b.com']});
    });
});

describe('mergedCoverage', () => {
    const coverage = (days, media) => ({media: media.length, news: days.reduce((sum, day) => sum + day.news, 0), first: null, peak: {day: days[0].day, media: 1}, days, languages: [],
        byMedium: media.map((medium, i) => ({medium, news: 1, firstAt: `2026-10-0${i + 1}T00:00:00.000Z`, languages: ['en']}))});

    it('should keep the days no longer held, take the new count of the others and add the new media', () => {
        const old = coverage([{day: '2026-09-30', media: 3, news: 4}, {day: '2026-10-05', media: 1, news: 1}], ['a.com', 'b.com']);
        const now = coverage([{day: '2026-10-05', media: 2, news: 3}, {day: '2026-10-06', media: 1, news: 1}], ['b.com', 'c.com']);
        const merged = mergedCoverage(old, now);
        expect(merged.days.map(day => day.day)).toEqual(['2026-09-30', '2026-10-05', '2026-10-06']);
        expect(merged.days[1].news).toBe(3);
        expect(merged.media).toBe(3);
        expect(merged.news).toBe(8);
    });

    it('should answer the one that exists when the other is empty', () => {
        const only = coverage([{day: '2026-10-05', media: 1, news: 1}], ['a.com']);
        expect(mergedCoverage(null, only)).toBe(only);
        expect(mergedCoverage(only, {media: 0, news: 0, days: [], byMedium: []})).toBe(only);
    });
});

describe('what the AI and the push say', () => {
    it('should ring only what the AI said true to, and nothing for an event it did not answer', () => {
        expect(normalizeConfirmed({news: [{n: 1, notify: true}, {n: 2, notify: 'yes'}]}, 3)).toEqual([true, false, false]);
        expect(normalizeConfirmed(null, 2)).toEqual([false, false]);
    });

    it('should give the push services a contact they accept: a mailto or an https address', () => {
        expect(subjectOf('mailto:a@b.ch')).toBe('mailto:a@b.ch');
        expect(subjectOf('a@b.ch')).toBe('mailto:a@b.ch');
        expect(subjectOf('https://news.fabianrostello.com')).toBe('https://news.fabianrostello.com');
        expect(subjectOf('news.fabianrostello.com')).toBe('https://news.fabianrostello.com');
    });

    it('should tell one fact as it is and several as a short list', () => {
        const alert = (title) => ({event: {title}});
        expect(messageOf({id: 5, title: 'The affair'}, [alert('One fact')])).toEqual({title: 'The affair', body: 'One fact', url: '/affairs/5', tag: 'affair-5'});
        const many = messageOf({id: 5, title: 'The affair'}, ['a', 'b', 'c', 'd'].map(alert));
        expect(many.body).toBe('• a\n• b\n• c\n+ 1 more');
    });
});
