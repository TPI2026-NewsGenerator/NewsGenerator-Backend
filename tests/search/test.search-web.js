//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.search-web.js
//  Description: A sentence our feeds answer little: Google News is asked it too, once, and its news
//               are searched with the others. The feeds of the directory are read by every search
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {
        userFeedUrls: jest.fn(async () => []),
        publicFeedUrls: jest.fn(async () => []),
        closestArticles: jest.fn(),
        similarArticlePairs: jest.fn(async () => []),
        threadArticles: jest.fn(async () => []),
    },
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: jest.fn()}}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({
    embed: jest.fn(async () => [{dense: [1], sparse: {}}]),
    toVector: jest.fn(() => '[1]'),
    toSparsevec: jest.fn(() => '{}/1'),
}));
jest.unstable_mockModule('../../services/utils/search-ai.js', () => ({sortByMeaning: jest.fn()}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({
    searchesOfCategories: jest.fn(async () => []),
    GOOGLE_ENABLED: jest.fn(() => true),
    IngestService: {readNow: jest.fn(async () => 3)},
}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({
    DirectoryModel: {feedUrls: jest.fn(async () => ['https://www.nbcnews.com/health/rss'])},
}));

const {NewsService} = await import('../../services/news-service.js');
const {FeedModel} = await import('../../models/feed-model.js');
const {sortByMeaning} = await import('../../services/utils/search-ai.js');
const {GOOGLE_ENABLED, IngestService} = await import('../../services/ingest-service.js');
const {DirectoryModel} = await import('../../models/directory-model.js');

const article = (id) => ({
    id, id_story: null, id_thread: null, title: `Measles outbreak grows in state ${id}`, link: `https://news.example/${id}`,
    description: '', thumbnail: null, published_at: new Date(Date.UTC(2026, 8, 28, 12 - id)),
});
const answering = (count) => (query, news) => ({answers: news.slice(0, count).map(item => item.id), related: news.slice(count).map(item => item.id)});
const search = () => NewsService.getNews({keywords: ['measles outbreaks'], category: ['science'], language: 'en',
    timeframe: {start: new Date(Date.now() - 7 * 24 * 3600e3).toISOString()}});
const feedsRead = (call) => FeedModel.closestArticles.mock.calls[call][0].feedUrls;

beforeEach(() => {
    jest.clearAllMocks();
    GOOGLE_ENABLED.mockReturnValue(true);
});

describe('a sentence our feeds answer little', () => {
    it('should ask Google News the sentence of the days searched, and search its news with the others', async () => {
        FeedModel.closestArticles.mockResolvedValueOnce([article(1), article(2)]).mockResolvedValueOnce([1, 2, 3, 4, 5, 6].map(article));
        sortByMeaning.mockImplementationOnce(answering(1)).mockImplementationOnce(answering(6));

        const result = await search();

        const [[urls]] = IngestService.readNow.mock.calls;
        expect(urls).toHaveLength(1);
        expect(new URL(urls[0]).searchParams.get('q')).toBe('measles outbreaks when:7d');
        expect(urls[0]).toContain('hl=en-US');
        expect(feedsRead(1)).toEqual([...feedsRead(0), urls[0]]);
        expect(result.web).toBe(true);
        expect(result.news).toHaveLength(6);
    });

    it('should give the AI the news of Google News for the sentence, whatever their vectors say', async () => {
        FeedModel.closestArticles.mockResolvedValueOnce([article(1)]).mockResolvedValueOnce([1, 2, 3, 4, 5, 6].map(article));
        sortByMeaning.mockImplementationOnce(answering(1)).mockImplementationOnce(answering(6));

        await search();

        const [[urls]] = IngestService.readNow.mock.calls;
        const [[first], [second]] = FeedModel.closestArticles.mock.calls;
        expect(first.givenFeeds).toEqual([]);
        expect(second.givenFeeds).toEqual(urls);
        expect(second.byGiven).toBeGreaterThan(0);
    });

    it('should not ask it when the feeds answer enough', async () => {
        FeedModel.closestArticles.mockResolvedValueOnce([1, 2, 3, 4, 5].map(article));
        sortByMeaning.mockImplementationOnce(answering(5));

        const result = await search();

        expect(IngestService.readNow).not.toHaveBeenCalled();
        expect(result.web).toBeUndefined();
        expect(result.news).toHaveLength(5);
    });

    it('should give the answer of the feeds when Google News can not be asked', async () => {
        GOOGLE_ENABLED.mockReturnValue(false);
        FeedModel.closestArticles.mockResolvedValueOnce([article(1)]);
        sortByMeaning.mockImplementationOnce(answering(1));

        const result = await search();

        expect(IngestService.readNow).not.toHaveBeenCalled();
        expect(FeedModel.closestArticles).toHaveBeenCalledTimes(1);
        expect(result.news).toHaveLength(1);
    });

    it('should not ask it when the searches are not to be sent to Google News', async () => {
        process.env.SEARCH_GOOGLE_NEWS = 'off';
        FeedModel.closestArticles.mockResolvedValueOnce([article(1)]);
        sortByMeaning.mockImplementationOnce(answering(1));

        const result = await search().finally(() => delete process.env.SEARCH_GOOGLE_NEWS);

        expect(IngestService.readNow).not.toHaveBeenCalled();
        expect(result.news).toHaveLength(1);
    });

    it('should give the answer of the feeds when Google News did not answer', async () => {
        IngestService.readNow.mockRejectedValueOnce(new Error('HTTP 503'));
        FeedModel.closestArticles.mockResolvedValueOnce([article(1)]);
        sortByMeaning.mockImplementationOnce(answering(1));

        const result = await search();

        expect(FeedModel.closestArticles).toHaveBeenCalledTimes(1);
        expect(result.web).toBeUndefined();
        expect(result.news).toHaveLength(1);
    });
});

describe('the feeds of the directory', () => {
    it('should be read by a search, of its categories and language', async () => {
        FeedModel.closestArticles.mockResolvedValueOnce([1, 2, 3, 4, 5].map(article));
        sortByMeaning.mockImplementationOnce(answering(5));

        await search();

        expect(DirectoryModel.feedUrls).toHaveBeenCalledWith(['science'], 'en');
        expect(feedsRead(0)).toContain('https://www.nbcnews.com/health/rss');
    });
});
