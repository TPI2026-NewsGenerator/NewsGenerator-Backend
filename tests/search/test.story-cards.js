//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.story-cards.js
//  Description: Tests for the cards of a search: a news in a story of the background work is grouped
//               with its story, the news in no story by the trigrams of their titles, and the stories
//               of one thread (one affair) are one card with the facts of the affair not found
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {
        userFeedUrls: jest.fn(async () => []),
        publicFeedUrls: jest.fn(async () => []),
        searchArticles: jest.fn(),
        closestArticles: jest.fn(),
        similarArticlePairs: jest.fn(),
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
jest.unstable_mockModule('../../services/ingest-service.js', () => ({searchesOfCategories: jest.fn(async () => [])}));

const {NewsService} = await import('../../services/news-service.js');
const {FeedModel} = await import('../../models/feed-model.js');
const {sortByMeaning} = await import('../../services/utils/search-ai.js');
const {searchesOfCategories} = await import('../../services/ingest-service.js');

const article = (id, host, title, story, thread = null) => ({
    id, id_story: story, id_thread: thread, title, link: `https://${host}/news/${id}`, description: '', thumbnail: null,
    published_at: new Date(Date.UTC(2026, 8, 28, 12 - id)),
});

// 1 and 2 in one story; 3 in another story, its title close to 1; 4 and 5 in no story, their titles
// close to each other and 4 close to 2
const articles = [
    article(1, 'bbc.co.uk', 'Clubs seek legal advice over Man City charges', 7),
    article(2, 'espn.com', 'PL clubs seeking legal advice over City charges', 7),
    article(3, 'skysports.com', 'Man City chairman responds to charges', 8),
    article(4, 'theguardian.com', 'Clubs weigh legal action over City charges', null),
    article(5, 'independent.co.uk', 'Clubs weigh legal action over City charges verdict', null),
];
const pairs = [
    {id_a: 1, id_b: 3, score: 0.4},
    {id_a: 2, id_b: 4, score: 0.5},
    {id_a: 4, id_b: 5, score: 0.9},
];
const members = (card) => [card.url, ...card.sources.map(source => source.url)].map(url => Number(url.split('/').pop()));

beforeEach(() => {
    jest.clearAllMocks();
    FeedModel.similarArticlePairs.mockResolvedValue(pairs);
    FeedModel.threadArticles.mockResolvedValue([]);
});

describe('the cards of a search by words', () => {
    it('should group a news with its story, and the news in no story by their titles only', async () => {
        FeedModel.searchArticles.mockResolvedValue(articles);

        const {news} = await NewsService.getNews({keywords: ['"legal", charges'], category: ['sport']});

        expect(news.map(members)).toEqual([[1, 2], [3], [4, 5]]);
        expect(news[0].corroboration).toEqual({media: 2, wordings: 2});
        // the same text at 0.85: one wording for two media
        expect(news[2].corroboration).toEqual({media: 2, wordings: 1});
    });

    it('should read the feeds of the reader and the ones of the others not private, in the language of the search', async () => {
        FeedModel.searchArticles.mockResolvedValue([]);
        FeedModel.userFeedUrls.mockResolvedValue(['https://own.test/rss']);
        FeedModel.publicFeedUrls.mockResolvedValue(['https://found.test/rss', 'https://own.test/rss']);
        searchesOfCategories.mockResolvedValue(['https://news.google.com/rss/search?q=cartes']);

        await NewsService.getNews({keywords: ['"legal"'], category: ['sport'], userId: 7, language: 'fr'});

        expect(FeedModel.userFeedUrls).toHaveBeenCalledWith(7, ['sport'], 'fr');
        expect(FeedModel.publicFeedUrls).toHaveBeenCalledWith(['sport'], 'fr');
        expect(searchesOfCategories).toHaveBeenCalledWith(['sport'], 'fr');
        const read = FeedModel.searchArticles.mock.calls[0][0].feedUrls;
        expect(read.filter(url => url === 'https://own.test/rss')).toHaveLength(1);
        expect(read).toEqual(expect.arrayContaining(['https://found.test/rss', 'https://news.google.com/rss/search?q=cartes']));
    });
});

describe('the cards of a search by meaning', () => {
    it('should give the AI one line per story and keep the whole story in the card', async () => {
        FeedModel.closestArticles.mockResolvedValue(articles);
        sortByMeaning.mockResolvedValue({answers: ['4', '5'], related: ['1']});

        const {news} = await NewsService.searchByMeaning({query: 'the legal action of the clubs', feedUrls: []});

        expect(sortByMeaning.mock.calls[0][1].map(line => line.id)).toEqual(['1', '3', '4', '5']);
        expect(news.map(members)).toEqual([[4, 5], [1, 2]]);
        expect(news.map(card => card.match)).toEqual(['answer', 'related']);
    });
});

describe('the cards of an affair', () => {
    // stories 7 and 8 are two facts of thread 70 (the verdict, the chairman's answer); story 9 is a third
    // fact of it the search did not find, told by two media
    const inThread = [
        article(1, 'bbc.co.uk', 'Clubs seek legal advice over Man City charges', 7, 70),
        article(2, 'espn.com', 'PL clubs seeking legal advice over City charges', 7, 70),
        article(3, 'skysports.com', 'Man City chairman responds to charges', 8, 70),
    ];
    const notFound = [
        {...article(11, 'nytimes.com', 'Man City found guilty on most charges', 9, 70), published_at: new Date(Date.UTC(2026, 8, 25))},
        {...article(12, 'theguardian.com', 'City guilty: the verdict explained', 9, 70), published_at: new Date(Date.UTC(2026, 8, 25, 2))},
    ];

    it('should put the facts of one thread on one card, in their order, with the facts not found', async () => {
        FeedModel.searchArticles.mockResolvedValue(inThread);
        FeedModel.threadArticles.mockResolvedValue(notFound);

        const {news} = await NewsService.getNews({keywords: ['"legal", charges'], category: ['sport']});

        expect(news).toHaveLength(1);
        // led by the first fact found, as a card of one fact would be
        expect(members(news[0])).toEqual([1, 2]);
        expect(news[0].facts.map(fact => [members(fact), fact.found])).toEqual([[[11, 12], false], [[3], true], [[1, 2], true]]);
        expect(news[0].facts[0].corroboration).toEqual({media: 2});
        // the facts not found are read from the feeds of the reader, the stories found left out
        expect(FeedModel.threadArticles).toHaveBeenCalledWith(expect.objectContaining({threadIds: [70], foundStoryIds: [7, 8]}));
    });

    it('should keep a news in no thread as a card of its own', async () => {
        FeedModel.searchArticles.mockResolvedValue(articles);

        const {news} = await NewsService.getNews({keywords: ['"legal", charges'], category: ['sport']});

        expect(news.map(card => card.facts.length)).toEqual([1, 1, 1]);
        expect(FeedModel.threadArticles).toHaveBeenCalledWith(expect.objectContaining({threadIds: []}));
    });
});
