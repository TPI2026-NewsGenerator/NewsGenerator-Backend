//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.watched-news.js
//  Description: The news of the terms a profile follows: every news naming one, whatever its relevance,
//               one line per story, the 100 newest listed and all of them counted
//

import {describe, expect, it, jest} from '@jest/globals';

const searchArticles = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {searchArticles}}));
const {watchedNews} = await import('../../services/briefing-service.js');

const at = new Date('2026-10-08T12:00:00Z');
const article = (id, story, title, changes = {}) => ({
    id, id_story: story, title, description: '', link: `https://media${id % 7}.example/${id}`, lang: 'en',
    published_at: new Date(at - id * 60e3), ...changes,
});

describe('watchedNews', () => {
    it('should list one line per story, the 100 newest, and count them all', async () => {
        // the newest first, as the search answers them
        searchArticles.mockResolvedValue(Array.from({length: 130}, (_, i) => article(i + 1, i + 1, `Dario Amodei speaks, part ${i + 1}`)));

        const [group] = await watchedNews(['Dario Amodei'], {feedUrls: ['https://feed.example/rss'], since: new Date(at - 864e5)});

        expect(group.count).toBe(130);
        expect(group.news).toHaveLength(100);
        expect(group.news[0].title).toBe('Dario Amodei speaks, part 1');
        expect(searchArticles).toHaveBeenCalledWith(expect.objectContaining({feedUrls: ['https://feed.example/rss']}));
    });

    it('should join the news of one story, telling how many media told it, and keep a news named in its description', async () => {
        searchArticles.mockResolvedValue([
            article(1, 10, 'Anthropic chief speaks', {description: 'The words of Dario Amodei on safety.'}),
            article(2, 10, 'Dario Amodei speaks', {link: 'https://other.example/2'}),
            article(3, 11, 'Nothing about him', {description: 'Amodeis is another word.'}),
        ]);

        const [group] = await watchedNews(['Dario Amodei'], {feedUrls: [], since: new Date(at - 864e5)});

        expect(group.count).toBe(1);
        expect(group.news).toEqual([expect.objectContaining({storyId: 10, title: 'Anthropic chief speaks', media: 2, excerpt: 'The words of Dario Amodei on safety.'})]);
    });

    it('should ask nothing for a profile following no term', async () => {
        searchArticles.mockClear();
        expect(await watchedNews([], {feedUrls: [], since: at})).toEqual([]);
        expect(searchArticles).not.toHaveBeenCalled();
    });
});
