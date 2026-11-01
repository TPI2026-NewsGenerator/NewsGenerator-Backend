//
//  Author: Fabian Rostello
//  Date: 01.11.2026
//  File: test.watch-window.js
//  Description: The news of what a profile follows, searched when the tab of the page is opened and not
//               with the briefing: the reader chooses how many each name should have and the search goes
//               back, day by day up to 30, until it finds them, in background when the list is long
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const profileModel = await import('../../models/profile-model.js');
const watchTerms = {current: ['VAR']};
jest.unstable_mockModule('../../models/profile-model.js', () => ({...profileModel, ProfileModel: {
    ...profileModel.ProfileModel,
    get: jest.fn(async () => ({id: 1, watch_terms: watchTerms.current})),
    briefingInterests: jest.fn(async () => [{id: 1, text: 'Swiss politics', project: null}]),
    projects: jest.fn(async () => []),
    removedSources: jest.fn(async () => []),
}}));
const briefingModel = await import('../../models/briefing-model.js');
const latest = jest.fn(async () => ({id: 40, status: 'ready'}));
const watched = jest.fn(async () => {});
jest.unstable_mockModule('../../models/briefing-model.js', () => ({...briefingModel, BriefingModel: {...briefingModel.BriefingModel,
    step: jest.fn(async () => {}), failAbandoned: jest.fn(async () => {}), latest, watched}}));
const discovery = await import('../../services/discovery-service.js');
jest.unstable_mockModule('../../services/discovery-service.js', () => ({...discovery, DiscoveryService: {...discovery.DiscoveryService, prune: jest.fn(async () => {})}}));
const feedback = await import('../../services/feedback-service.js');
jest.unstable_mockModule('../../services/feedback-service.js', () => ({...feedback, FeedbackService: {...feedback.FeedbackService, of: jest.fn(async () => ({refused: [], examples: []}))}}));
const feedModel = await import('../../models/feed-model.js');
jest.unstable_mockModule('../../models/feed-model.js', () => ({...feedModel, FeedModel: {...feedModel.FeedModel,
    userFeedUrls: jest.fn(async () => []), everyoneFeedUrls: jest.fn(async () => []), trustedMedia: jest.fn(async () => [])}}));
const ingest = await import('../../services/ingest-service.js');
jest.unstable_mockModule('../../services/ingest-service.js', () => ({...ingest, searchesOfUser: jest.fn(async () => [])}));
// the briefing is stopped at its ranking
const storyModel = await import('../../models/story-model.js');
jest.unstable_mockModule('../../models/story-model.js', () => ({...storyModel, StoryModel: {...storyModel.StoryModel, rank: jest.fn(async () => { throw new Error('stopped'); })}}));
// not read before it is mocked: it reads the briefing service, which would keep the real one
const briefingGroups = jest.fn(async () => []);
const wordsGroups = jest.fn(async () => []);
const followTerms = jest.fn();
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {briefingGroups, wordsGroups, followTerms}}));

const {write, BriefingService, followingNews, followedNews, untilEnough, WATCH_LIMITS, WATCH_LIMIT, WATCH_STEPS, FOLLOWING_BUDGET_MS} =
    await import('../../services/briefing-service.js');

// a word named by this many stories of different media, the newest first
const named = (count) => Array.from({length: count}, (_, i) => ({storyId: i + 1, title: `VAR news ${i + 1}`, url: `https://m${i}.example/${i}`, link: `https://m${i}.example/${i}`,
    source: 'm.example', language: 'en', publishedAt: new Date(Date.now() - i * 60e3).toISOString(), media: 1, excerpt: null}));
const group = (term, count, news = named(Math.min(count, 100))) => ({term, count, news});
const ROSETTI = {label: 'Rosetti', qid: 'Q2', names: ['Roberto Rosetti']};
const WORD = (word) => ({label: word, qid: null, names: [word]});

let profile = 100;
beforeEach(() => {
    // each test its own profile: the answers are kept a few minutes for a profile
    profile += 1;
    watchTerms.current = ['VAR'];
    briefingGroups.mockReset().mockResolvedValue([]);
    wordsGroups.mockReset().mockImplementation(async (profileId, words) => words.map(word => group(word, 0)));
    followTerms.mockReset().mockImplementation(async (profileId, words) => [ROSETTI, ...words.map(WORD)]);
    latest.mockClear().mockResolvedValue({id: 40, status: 'ready'});
    watched.mockClear();
});

describe('the news wanted for each name followed', () => {
    it('should offer 10 to 100 news by tens, 100 by default, and go back 1, 2, 4, 8, 16 then 30 days', () => {
        expect(WATCH_LIMITS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
        expect(WATCH_LIMIT).toBe(100);
        expect(WATCH_STEPS).toEqual([24, 48, 96, 192, 384, 720]);
    });

    it('should refuse a number of news the bar does not offer', async () => {
        await expect(followingNews(profile, 15)).rejects.toMatchObject({status: 400, message: expect.stringContaining('limit')});
        await expect(followingNews(profile, 0)).rejects.toMatchObject({status: 400});
        await expect(followingNews(profile, 110)).rejects.toMatchObject({status: 400});
    });
});

describe('untilEnough', () => {
    // stories a day of each key: the count grows with the window, as the news do
    const perDay = {frequent: 60, middling: 4, rare: 0.1};
    const readOf = (calls) => async (keys, hours) => {
        calls.push([keys, hours]);
        return new Map((keys ?? Object.keys(perDay)).map(key => [key, {term: key, count: Math.floor(perDay[key] * hours / 24), news: []}]));
    };

    it('should stop at the window where a name has enough, and read the others again over a longer one', async () => {
        const calls = [];
        const groups = await untilEnough(['frequent', 'middling', 'rare'], readOf(calls), 100);
        expect(calls[0]).toEqual([['frequent', 'middling', 'rare'], 24]);
        expect(groups.map(found => found.term)).toEqual(['frequent', 'middling', 'rare']);
        // the frequent one has 120 stories in 2 days: done there, each group telling the window it was last read over
        expect(groups[0]).toMatchObject({term: 'frequent', hours: 48, count: 120, limit: 100});
        // the others go back the month
        expect(groups[1]).toMatchObject({term: 'middling', hours: 720, count: 120});
        expect(groups[2]).toMatchObject({term: 'rare', hours: 720, count: 3});
        // once done, a name is not read again
        expect(calls.filter(([, hours]) => hours > 48).flatMap(([keys]) => keys)).not.toContain('frequent');
        expect(calls.map(([, hours]) => hours)).toEqual(WATCH_STEPS);
    });

    it('should read once over the first window a name already satisfied by it, and nothing without a name', async () => {
        const calls = [];
        await untilEnough(['frequent'], async (keys, hours) => { calls.push(hours); return new Map([['frequent', {term: 'frequent', count: 500, news: []}]]); }, 100);
        expect(calls).toEqual([24]);

        const none = [];
        expect(await untilEnough([], async (keys) => { none.push(keys); return new Map(); }, 100)).toEqual([]);
        expect(none).toEqual([]);
    });

    it('should read every item first when it does not know them, and only the ones with too few after', async () => {
        const calls = [];
        const groups = await untilEnough(null, async (keys, hours) => {
            calls.push([keys, hours]);
            const all = new Map([['Q1', {term: 'UEFA', qid: 'Q1', count: 100, news: []}], ['Q2', {term: 'Rosetti', qid: 'Q2', count: hours >= 384 ? 2 : 0, news: []}]]);
            return keys === null ? all : new Map([...all].filter(([key]) => keys.includes(key)));
        }, 100);
        expect(calls[0]).toEqual([null, 24]);
        expect(calls.slice(1).every(([keys]) => keys.length === 1 && keys[0] === 'Q2')).toBe(true);
        expect(calls.map(([, hours]) => hours)).toEqual(WATCH_STEPS);
        expect(groups.map(found => [found.term, found.hours])).toEqual([['UEFA', 24], ['Rosetti', 720]]);
    });

    it('should tell each window done, and stop widening when the next would end after the time given', async () => {
        const steps = [];
        let stopped = 0;
        const slow = async (keys, hours) => {
            await new Promise(resolve => setTimeout(resolve, 30));
            return new Map([['rare', {term: 'rare', count: 1, news: []}]]);
        };
        // each window takes 30 ms, the next twice that: only a little time left after two windows
        const groups = await untilEnough(['rare'], slow, 100, WATCH_STEPS, {onStep: found => steps.push(found.length), stopAt: Date.now() + 100, onStop: () => stopped++});
        expect(steps.length).toBeGreaterThanOrEqual(1);
        expect(steps.length).toBeLessThan(WATCH_STEPS.length);
        expect(stopped).toBe(1);
        // what was found is kept, with the window it was read over
        expect(groups).toEqual([expect.objectContaining({term: 'rare', count: 1, hours: WATCH_STEPS[steps.length - 1]})]);
    });
});

describe('followedNews', () => {
    it('should search the items and the words together, tell how far the names are, and say when it stopped', async () => {
        briefingGroups.mockImplementation(async (profileId, hours, {only}) => (only === null || only.includes('Q2')) ? [{term: 'Rosetti', qid: 'Q2', count: 2, news: []}] : []);
        const progress = [];
        const {groups, partial} = await followedNews(1, ['VAR'], {limit: 100, onProgress: report => progress.push(report)});

        expect(partial).toBe(false);
        expect(groups.map(found => [found.term, found.qid, found.hours])).toEqual([['Rosetti', 'Q2', 720], ['VAR', null, 720]]);
        // the names done: none until they went back the month, both then
        expect(progress.at(-1)).toEqual({finished: 2, total: 2});
        expect(progress.some(report => report.finished < report.total)).toBe(true);
    });
});

describe('the news of what the profile follows, searched when the tab is opened', () => {
    it('should search a rare name and a word over a window growing to 30 days, asking the limit chosen', async () => {
        briefingGroups.mockImplementation(async (profileId, hours, {only}) => (only === null || only.includes('Q2')) ? [{term: 'Rosetti', qid: 'Q2', count: 2, news: []}] : []);
        const answer = await followingNews(profile, 20);

        expect(answer).toMatchObject({status: 'ready', limit: 20, partial: false});
        expect(briefingGroups.mock.calls.map(([, hours]) => hours)).toEqual(WATCH_STEPS);
        expect(briefingGroups.mock.calls[0][2]).toEqual({limit: 20, only: null});
        expect(briefingGroups.mock.calls[1][2]).toEqual({limit: 20, only: ['Q2']});
        // the word, named by nothing, is searched over the same windows
        expect(wordsGroups.mock.calls.map(([, words, hours]) => [words, hours])).toEqual(WATCH_STEPS.map(hours => [['VAR'], hours]));
        expect(wordsGroups.mock.calls[0][3]).toEqual({limit: 20});
    });

    it('should search a word named often over the first day only, and answer the groups with the terms marked', async () => {
        wordsGroups.mockImplementation(async (profileId, words) => words.map(word => group(word, 120)));
        const answer = await followingNews(profile);

        expect(wordsGroups).toHaveBeenCalledTimes(1);
        expect(briefingGroups.mock.calls[0][2]).toEqual({limit: 100, only: null});
        expect(answer.limit).toBe(100);
        const word = answer.groups.find(found => found.term === 'VAR');
        expect(word).toMatchObject({term: 'VAR', qid: null, count: 120, hours: 24, limit: 100});
        expect(word.news).toHaveLength(100);
        // "VAR news 1": the places of the word in the title
        expect(word.news[0].marks).toEqual({title: [[0, 3]]});
    });

    it('should mark the words around the term when the title does not name it', async () => {
        wordsGroups.mockImplementation(async (profileId, words) => words.map(word => group(word, 1,
            [{storyId: 1, title: 'Match report', url: 'https://m.example/1', link: 'https://m.example/1', excerpt: 'The images of the VAR changed everything.'}])));
        const word = (await followingNews(profile)).groups.find(found => found.term === 'VAR');
        expect(word.news[0].marks.excerpt).toHaveLength(1);
        expect(word.news[0].marks.title).toBeUndefined();
    });

    it('should keep the answer a few minutes for what the profile follows and the number wanted', async () => {
        wordsGroups.mockImplementation(async (profileId, words) => words.map(word => group(word, 120)));
        const first = await followingNews(profile, 50);
        const again = await followingNews(profile, 50);
        expect(again).toEqual(first);
        expect(wordsGroups).toHaveBeenCalledTimes(1);

        // another number, or another thing followed, is another search
        await followingNews(profile, 60);
        expect(wordsGroups).toHaveBeenCalledTimes(2);
        watchTerms.current = ['VAR', 'UEFA'];
        await followingNews(profile, 60);
        expect(wordsGroups).toHaveBeenCalledTimes(3);
    });

    it('should search nothing for a profile that follows nothing', async () => {
        followTerms.mockResolvedValue([]);
        expect(await followingNews(profile)).toEqual({status: 'ready', limit: 100, partial: false, groups: []});
        expect(await followingNews(null)).toEqual({status: 'ready', limit: 100, partial: false, groups: []});
        expect(briefingGroups).not.toHaveBeenCalled();
        expect(wordsGroups).not.toHaveBeenCalled();
        expect(watched).not.toHaveBeenCalled();
    });

    it('should answer that it is running, with the names done, when the search is long, then the news once it ends', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        wordsGroups.mockImplementation(async (profileId, words) => { await gate; return words.map(word => group(word, 120)); });

        const running = await followingNews(profile, 30, {waitMs: 20});
        expect(running).toMatchObject({status: 'running', limit: 30});
        // asked again while it runs: the same search, not another
        expect(await followingNews(profile, 30, {waitMs: 20})).toMatchObject({status: 'running'});
        expect(briefingGroups).toHaveBeenCalledTimes(1);

        release();
        const ready = await followingNews(profile, 30, {waitMs: 1000});
        expect(ready).toMatchObject({status: 'ready', limit: 30});
        expect(ready.groups.map(found => found.term)).toEqual(['VAR']);
    });

    it('should say when the search failed, and search again the next time', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        wordsGroups.mockRejectedValueOnce(new Error('database down'));
        await expect(followingNews(profile, 40)).rejects.toMatchObject({status: 502, message: 'database down'});
        spy.mockRestore();

        expect(await followingNews(profile, 40)).toMatchObject({status: 'ready'});
    });

    it('should refuse another search while several are running', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        wordsGroups.mockImplementation(async (profileId, words) => { await gate; return words.map(word => group(word, 1)); });
        for (const other of [1, 2, 3, 4]) expect(await followingNews(profile + 1000 + other, 10, {waitMs: 5})).toMatchObject({status: 'running'});

        await expect(followingNews(profile, 10, {waitMs: 5})).rejects.toMatchObject({status: 503});
        release();
        // the four end, the next is searched
        await Promise.all([1, 2, 3, 4].map(other => followingNews(profile + 1000 + other, 10, {waitMs: 1000})));
        expect(await followingNews(profile, 10, {waitMs: 1000})).toMatchObject({status: 'ready'});
    });

    it('should stop within the three minutes the reader waits at most', () => {
        expect(FOLLOWING_BUDGET_MS).toBeLessThanOrEqual(180e3);
    });

    it('should note on the last ready briefing what the reader was shown, for the directory', async () => {
        wordsGroups.mockImplementation(async (profileId, words) => words.map(word => group(word, 3)));
        await followingNews(profile);
        expect(watched).toHaveBeenCalledWith(40, expect.arrayContaining([expect.objectContaining({term: 'VAR', count: 3})]));

        // not on a briefing still written, nor when the note fails: the answer comes all the same
        watched.mockClear();
        latest.mockResolvedValue({id: 41, status: 'running'});
        await followingNews(profile, 90);
        expect(watched).not.toHaveBeenCalled();

        latest.mockRejectedValue(new Error('database down'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await followingNews(profile, 80)).groups).toHaveLength(1);
        spy.mockRestore();
    });

    it('should be what the service gives the page', () => {
        expect(BriefingService.following).toBe(followingNews);
    });
});

describe('the briefing written', () => {
    it('should not search the news of what the profile follows, the tab asks for them', async () => {
        await expect(write(null, 1, 48, 10)).rejects.toThrow('stopped');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(briefingGroups).not.toHaveBeenCalled();
        expect(wordsGroups).not.toHaveBeenCalled();
        expect(watched).not.toHaveBeenCalled();
    });
});
