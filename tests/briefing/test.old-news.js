//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.old-news.js
//  Description: Tests for the news told before the window of a briefing and only told again in it (a friend of the user, 10.11.2026): which
//               stories are judged, what the AI is told, and that the code keeps everything the AI did not clearly call old
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {ASK_BY, EARLIER, GRACE_HOURS, normalizeOld, notOldNews, oldNewsPrompt, oldStories, withoutOldNews} = await import('../../services/utils/old-news.js');

const NOW = Date.parse('2026-11-10T07:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600e3);
const row = (title, hours, medium = `${title}.example`) => ({title, at: hoursAgo(hours), medium});
// a story of the window: its news (newest first, as the briefing has them), its lead
const story = (storyId, members, extra = {}) => ({storyId, members, best: {title: `Lead ${storyId}`}, ...extra});

beforeEach(() => chat.mockReset());

describe('oldNewsPrompt', () => {
    const asked = [{id: '7', title: 'Argentina appeal to CAS', earlier: [row('Argentina plan an appeal', 79)], within: [row('Argentina take the appeal to CAS', 10)]}];

    it('should give the headline, the earlier coverage and the window, each news with its age, and the window said in days for a long one', () => {
        const prompt = oldNewsPrompt(asked, 24, NOW);
        expect(prompt).toContain('[7] Headline: "Argentina appeal to CAS"');
        expect(prompt).toContain('Earlier coverage:\n- 3.3 days ago: Argentina plan an appeal');
        expect(prompt).toContain('During the last 24 hours:\n- 10 hours ago: Argentina take the appeal to CAS');
        expect(oldNewsPrompt(asked, 72, NOW)).toContain('During the last 3 days:');
    });

    it('should say what is new and what is old, and that a doubt leaves the news out', () => {
        const prompt = oldNewsPrompt(asked, 24, NOW);
        expect(prompt).toMatch(/It is OLD when that fact was already in the earlier coverage/);
        expect(prompt).toMatch(/It is NEW when it is the event itself after its announcement/);
        expect(prompt).toContain('When in doubt, it is old');
    });
});

describe('normalizeOld', () => {
    it('should keep only the stories asked answered true, with the earlier fact named', () => {
        const asked = [{id: '1'}, {id: '2'}, {id: '3'}];
        const answer = {stories: [{id: '1', earlier: 'the appeal', old: true}, {id: '[2]', old: 'true'}, {id: '3', old: false}, {id: '9', old: true}, null]};
        expect([...normalizeOld(answer, asked)]).toEqual([['1', 'the appeal']]);
        expect(normalizeOld(null, asked).size).toBe(0);
        expect(normalizeOld({stories: 'all'}, asked).size).toBe(0);
    });
});

describe('oldStories', () => {
    const many = (n) => Array.from({length: n}, (_, i) => ({id: String(i + 1), title: `Story ${i + 1}`, earlier: [row('Before', 50)], within: [row('Now', 2)]}));

    it('should ask the stories ASK_BY at a time, and gather what each call answers old', async () => {
        const judge = jest.fn(async (prompt) => ({stories: [{id: prompt.includes('[1] ') ? '1' : '31', old: true, earlier: 'known'}]}));
        const old = await oldStories(many(ASK_BY + 5), 24, {now: NOW, judge});
        expect(judge).toHaveBeenCalledTimes(2);
        expect([...old.keys()].sort()).toEqual(['1', '31']);
    });

    it('should keep the stories of a call that fails, and judge the others', async () => {
        const judge = jest.fn()
            .mockRejectedValueOnce(new Error('The AI is busy'))
            .mockResolvedValueOnce({stories: [{id: '31', old: true, earlier: 'known'}]});
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const old = await oldStories(many(ASK_BY + 5), 24, {now: NOW, judge});
        expect([...old.keys()]).toEqual(['31']);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('30 stories were not judged'));
        error.mockRestore();
    });

    it('should ask nothing for no story', async () => {
        const judge = jest.fn();
        expect((await oldStories([], 24, {judge})).size).toBe(0);
        expect(judge).not.toHaveBeenCalled();
    });
});

describe('withoutOldNews', () => {
    const answers = (...ids) => jest.fn(async () => ({stories: ids.map(id => ({id: String(id), earlier: 'the first report', old: true}))}));

    it('should ask only the stories the media had told before the window, and leave out the ones the AI calls old, the others in their order', async () => {
        const stories = [
            story(1, [row('Today A', 3)]),                                  // told before, the AI says old
            story(2, [row('Today B', 3)]),                                  // told before, the AI says new
            story(3, [row('Today C', 3)]),                                  // nothing before the window: not asked
        ];
        const earlierOf = new Map([[1, [row('Before 1', 60)]], [2, [row('Before 2', 60)]]]);
        const judge = answers(1);
        const result = await withoutOldNews(stories, earlierOf, 24, {now: NOW, judge});
        expect(result.stories.map(one => one.storyId)).toEqual([2, 3]);
        expect(result.left).toEqual([{storyId: 1, earlier: 'the first report'}]);
        const prompt = judge.mock.calls[0][0];
        expect(prompt).toContain('[1] Headline: "Lead 1"');
        expect(prompt).toContain('[2] Headline: "Lead 2"');
        expect(prompt).not.toContain('[3] Headline');
    });

    it('should not ask a story that follows a card of before, judged on what is new since, nor one with no news in the window', async () => {
        const stories = [story(1, [row('Today', 3)], {followUp: {storyId: 90}}), story(2, [])];
        const earlierOf = new Map([[1, [row('Before', 60)]], [2, [row('Before', 60)]]]);
        const judge = answers(1, 2);
        const result = await withoutOldNews(stories, earlierOf, 24, {now: NOW, judge});
        expect(judge).not.toHaveBeenCalled();
        expect(result.stories).toHaveLength(2);
    });

    it('should give one news a medium, the first ones of the earlier coverage and the newest of the window', async () => {
        const earlier = Array.from({length: EARLIER + 3}, (_, i) => row(`Before ${i}`, 100 - i));
        const window = [row('Old one', 20, 'same.example'), row('Same medium', 19, 'same.example'), ...Array.from({length: 10}, (_, i) => row(`Now ${i}`, 10 - i))];
        const judge = answers();
        await withoutOldNews([story(1, [...window].reverse())], new Map([[1, [...earlier, row('Twice', 40, earlier[0].medium)]]]), 24, {now: NOW, judge});
        const prompt = judge.mock.calls[0][0];
        const before = prompt.split('Earlier coverage:\n')[1].split('\nDuring')[0].split('\n');
        expect(before).toHaveLength(EARLIER);
        expect(before[0]).toContain('Before 0');
        const now = prompt.split('During the last 24 hours:\n')[1].split('\n\n')[0].split('\n').filter(line => line.startsWith('- '));
        // 8 at most, the newest, oldest first; the second news of a medium is not given
        expect(now).toHaveLength(8);
        expect(now.at(-1)).toContain('Now 9');
        expect(prompt).not.toContain('Same medium');
    });

    it('should keep every story when the AI fails or answers nothing', async () => {
        const stories = [story(1, [row('Today', 3)]), story(2, [row('Today', 3)])];
        const earlierOf = new Map([[1, [row('Before', 60)]], [2, [row('Before', 60)]]]);
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const failing = await withoutOldNews(stories, earlierOf, 24, {now: NOW, judge: jest.fn().mockRejectedValue(new Error('down'))});
        expect(failing.stories).toHaveLength(2);
        expect(failing.left).toEqual([]);
        const silent = await withoutOldNews(stories, earlierOf, 24, {now: NOW, judge: jest.fn(async () => ({}))});
        expect(silent.stories).toHaveLength(2);
        error.mockRestore();
    });

    it('should use the first news of the window as the headline of a story with no lead', async () => {
        const judge = answers();
        await withoutOldNews([{storyId: 5, members: [row('Newest', 2), row('Oldest', 9)]}], new Map([[5, [row('Before', 60)]]]), 24, {now: NOW, judge});
        expect(judge.mock.calls[0][0]).toContain('[5] Headline: "Newest"');
    });
});

describe('notOldNews', () => {
    const since = hoursAgo(24);
    const found = (id, title, hours) => ({id_story: id, title, at: hoursAgo(hours), medium: `${title}.example`});

    it('should read the news told GRACE_HOURS before the window began, of the stories that do not follow a card, and leave out the old ones', async () => {
        const stories = [story(1, [row('Today', 3)]), story(2, [row('Today', 3)]), story(3, [row('Today', 3)], {followUp: {storyId: 90}})];
        const earlierNews = jest.fn(async () => [found(1, 'Before one', 60), found(2, 'Before two', 70)]);
        const judge = jest.fn(async () => ({stories: [{id: '1', earlier: 'known', old: true}]}));
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const kept = await notOldNews(stories, {since, hours: 24, earlierNews, judge, now: NOW});
        expect(kept.map(one => one.storyId)).toEqual([2, 3]);
        expect(earlierNews).toHaveBeenCalledWith({storyIds: [1, 2], before: new Date(since.getTime() - GRACE_HOURS * 3600e3), perStory: EARLIER});
        expect(log).toHaveBeenCalledWith(expect.stringContaining('[1] known'));
        log.mockRestore();
    });

    it('should keep every story when reading the news before fails', async () => {
        const stories = [story(1, [row('Today', 3)])];
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const kept = await notOldNews(stories, {since, hours: 24, earlierNews: jest.fn().mockRejectedValue(new Error('database down')), judge: jest.fn()});
        expect(kept).toBe(stories);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('database down'));
        error.mockRestore();
    });

    it('should keep every story when all of them are judged old: that would be no briefing', async () => {
        const stories = [story(1, [row('Today', 3)]), story(2, [row('Today', 3)])];
        const earlierNews = jest.fn(async () => [found(1, 'Before', 60), found(2, 'Before', 60)]);
        const judge = jest.fn(async () => ({stories: [{id: '1', old: true}, {id: '2', old: true}]}));
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        expect(await notOldNews(stories, {since, hours: 24, earlierNews, judge, now: NOW})).toBe(stories);
        log.mockRestore();
    });

    it('should read nothing when every story follows a card of before', async () => {
        const stories = [story(1, [row('Today', 3)], {followUp: {storyId: 90}})];
        const earlierNews = jest.fn();
        expect(await notOldNews(stories, {since, hours: 24, earlierNews, judge: jest.fn()})).toBe(stories);
        expect(earlierNews).not.toHaveBeenCalled();
    });
});
