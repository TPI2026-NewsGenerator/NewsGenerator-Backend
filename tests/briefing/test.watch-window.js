//
//  Author: Fabian Rostello
//  Date: 01.11.2026
//  File: test.watch-window.js
//  Description: The news of what a profile follows: the reader chooses how many each name should have and
//               the search goes back, day by day up to 30, until it finds them
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const profileModel = await import('../../models/profile-model.js');
jest.unstable_mockModule('../../models/profile-model.js', () => ({...profileModel, ProfileModel: {
    ...profileModel.ProfileModel,
    get: jest.fn(async () => ({id: 1, watch_terms: ['VAR']})),
    briefingInterests: jest.fn(async () => [{id: 1, text: 'Swiss politics', project: null}]),
    projects: jest.fn(async () => []),
    removedSources: jest.fn(async () => []),
}}));
const briefingModel = await import('../../models/briefing-model.js');
jest.unstable_mockModule('../../models/briefing-model.js', () => ({...briefingModel, BriefingModel: {...briefingModel.BriefingModel, step: jest.fn(async () => {}), failAbandoned: jest.fn(async () => {})}}));
const discovery = await import('../../services/discovery-service.js');
jest.unstable_mockModule('../../services/discovery-service.js', () => ({...discovery, DiscoveryService: {...discovery.DiscoveryService, prune: jest.fn(async () => {})}}));
const feedback = await import('../../services/feedback-service.js');
jest.unstable_mockModule('../../services/feedback-service.js', () => ({...feedback, FeedbackService: {...feedback.FeedbackService, of: jest.fn(async () => ({refused: [], examples: []}))}}));
const feedModel = await import('../../models/feed-model.js');
const searchArticles = jest.fn(async () => []);
jest.unstable_mockModule('../../models/feed-model.js', () => ({...feedModel, FeedModel: {...feedModel.FeedModel,
    userFeedUrls: jest.fn(async () => []), everyoneFeedUrls: jest.fn(async () => []), trustedMedia: jest.fn(async () => []), searchArticles}}));
const ingest = await import('../../services/ingest-service.js');
jest.unstable_mockModule('../../services/ingest-service.js', () => ({...ingest, searchesOfUser: jest.fn(async () => [])}));
// the briefing is stopped at its ranking: what the profile follows is looked for before it
const storyModel = await import('../../models/story-model.js');
jest.unstable_mockModule('../../models/story-model.js', () => ({...storyModel, StoryModel: {...storyModel.StoryModel, rank: jest.fn(async () => { throw new Error('stopped'); })}}));
// not read before it is mocked: it reads the briefing service, which would keep the real one
const briefingGroups = jest.fn(async () => []);
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {briefingGroups}}));

const {write, BriefingService, untilEnough, WATCH_LIMITS, WATCH_LIMIT, WATCH_STEPS} = await import('../../services/briefing-service.js');

const DAY = 24 * 3600e3;
// a word named by this many stories of different media, the newest first
const named = (count) => Array.from({length: count}, (_, i) => ({id: i + 1, id_story: i + 1, title: `VAR news ${i + 1}`, description: '', link: `https://m${i}.example/${i}`, published_at: new Date(Date.now() - i * 60e3)}));

beforeEach(() => {
    briefingGroups.mockReset().mockResolvedValue([]);
    searchArticles.mockReset().mockResolvedValue([]);
});

describe('the news wanted for each name followed', () => {
    it('should offer 10 to 100 news by tens, 100 by default, and go back 1, 2, 4, 8, 16 then 30 days', () => {
        expect(WATCH_LIMITS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
        expect(WATCH_LIMIT).toBe(100);
        expect(WATCH_STEPS).toEqual([24, 48, 96, 192, 384, 720]);
    });

    it('should refuse a number of news the bar does not offer', async () => {
        await expect(BriefingService.start(1, 5, 48, 10, 15)).rejects.toMatchObject({status: 400, message: expect.stringContaining('watchLimit')});
        await expect(BriefingService.start(1, 5, 48, 10, 0)).rejects.toMatchObject({status: 400});
        await expect(BriefingService.start(1, 5, 48, 10, 110)).rejects.toMatchObject({status: 400});
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
        expect(groups.map(group => group.term)).toEqual(['frequent', 'middling', 'rare']);
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
        expect(groups.map(group => [group.term, group.hours])).toEqual([['UEFA', 24], ['Rosetti', 720]]);
    });
});

describe('the news of what the profile follows in a briefing', () => {
    it('should read a rare name and a word over a window growing to 30 days, asking the limit chosen', async () => {
        briefingGroups.mockImplementation(async (profileId, hours, {only}) => (only === null || only.includes('Q2')) ? [{term: 'Rosetti', qid: 'Q2', count: 2, news: []}] : []);
        await expect(write(null, 1, 48, 10, 20)).rejects.toThrow('stopped');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(briefingGroups.mock.calls.map(([, hours]) => hours)).toEqual(WATCH_STEPS);
        expect(briefingGroups.mock.calls[0][2]).toEqual({limit: 20, only: null});
        expect(briefingGroups.mock.calls[1][2]).toEqual({limit: 20, only: ['Q2']});
        // the word, named by nothing, is read over the same windows
        const starts = searchArticles.mock.calls.map(([{timeframe}]) => Math.round((Date.now() - timeframe.start.getTime()) / DAY));
        expect(starts).toEqual([1, 2, 4, 8, 16, 30]);
    });

    it('should read a word named often over the first day only', async () => {
        searchArticles.mockResolvedValue(named(120));
        await expect(write(null, 1, 48, 10)).rejects.toThrow('stopped');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(searchArticles).toHaveBeenCalledTimes(1);
        expect(briefingGroups.mock.calls[0][2]).toEqual({limit: 100, only: null});
    });
});
