//
//  Author: Fabian Rostello
//  Date: 01.10.2026
//  File: test.search-languages.js
//  Description: A search reads every language: the cards of two languages telling the same fact are
//               joined when the AI says so, asked only of the cards whose texts are close
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {
        closestArticles: jest.fn(),
        similarArticlePairs: jest.fn(async () => []),
        threadArticles: jest.fn(async () => []),
        crossLanguagePairs: jest.fn(async () => []),
    },
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: jest.fn()}}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({
    embed: jest.fn(async () => [{dense: [1], sparse: {}}]),
    toVector: jest.fn(() => '[1]'),
    toSparsevec: jest.fn(() => '{}/1'),
}));
jest.unstable_mockModule('../../services/utils/search-ai.js', () => ({sortByMeaning: jest.fn()}));
jest.unstable_mockModule('../../services/utils/profile-ai.js', () => ({mergeStories: jest.fn()}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({
    searchesOfCategories: jest.fn(async () => []),
    sentenceFeeds: jest.fn(async () => []),
    GOOGLE_ENABLED: () => false,
    IngestService: {readNow: jest.fn()},
}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {feedUrls: jest.fn(async () => [])}}));

const {NewsService} = await import('../../services/news-service.js');
const {FeedModel} = await import('../../models/feed-model.js');
const {sortByMeaning} = await import('../../services/utils/search-ai.js');
const {mergeStories} = await import('../../services/utils/profile-ai.js');

const article = (id, host, title, lang) => ({
    id, id_story: id * 10, id_thread: null, title, lang, link: `https://${host}/news/${id}`, description: '', thumbnail: null,
    published_at: new Date(Date.UTC(2026, 9, 1, 12 - id)),
});
// one fact told in French, English and German, and another fact in English
const ARTICLES = [
    article(1, 'lequipe.fr', "Affaire Negreira : l'UEFA rouvre le dossier du Barça", 'fr'),
    article(2, 'bbc.co.uk', 'UEFA reopens Negreira case against Barcelona', 'en'),
    article(3, 'kicker.de', 'UEFA nimmt Fall Negreira wieder auf', 'de'),
    article(4, 'espn.com', 'Barcelona coach angry at referees', 'en'),
];
const search = () => NewsService.searchByMeaning({query: "l'affaire Negreira", feedUrls: [], language: 'fr'});

beforeEach(() => {
    jest.clearAllMocks();
    FeedModel.closestArticles.mockResolvedValue(ARTICLES);
    sortByMeaning.mockResolvedValue({answers: ['1', '2', '3'], related: ['4']});
});

describe('the cards of a fact in several languages', () => {
    it('should join the cards the AI says tell the same fact, led by the first, their media counted', async () => {
        FeedModel.crossLanguagePairs.mockResolvedValueOnce([{a: 0, b: 1, similarity: 0.92}, {a: 0, b: 2, similarity: 0.88}, {a: 1, b: 3, similarity: 0.76}]);
        mergeStories.mockResolvedValueOnce(new Map([['1', '0'], ['2', '0']]));

        const {news} = await search();

        expect(news.map(card => card.url)).toEqual(['https://lequipe.fr/news/1', 'https://espn.com/news/4']);
        expect(news[0].sources.map(source => source.url)).toEqual(['https://bbc.co.uk/news/2', 'https://kicker.de/news/3']);
        expect(news[0].corroboration).toEqual({media: 3, wordings: 3});
        expect(mergeStories.mock.calls[0][0].map(card => card.id)).toEqual(['0', '1', '2', '3']);
    });

    it('should count once a medium writing the fact in two languages', async () => {
        FeedModel.closestArticles.mockResolvedValueOnce([
            article(1, 'goal.com', "Affaire Negreira : l'UEFA rouvre le dossier du Barça", 'fr'),
            article(2, 'goal.com', 'UEFA reopens Negreira case against Barcelona', 'en'),
            article(3, 'kicker.de', 'UEFA nimmt Fall Negreira wieder auf', 'de'),
            article(4, 'espn.com', 'Barcelona coach angry at referees', 'en'),
        ]);
        FeedModel.crossLanguagePairs.mockResolvedValueOnce([{a: 0, b: 1, similarity: 0.92}, {a: 0, b: 2, similarity: 0.88}]);
        mergeStories.mockResolvedValueOnce(new Map([['1', '0'], ['2', '0']]));

        const {news} = await search();

        expect(news[0].corroboration).toEqual({media: 2, wordings: 2});
    });

    it('should not join two cards that were not close, whatever the AI says', async () => {
        FeedModel.crossLanguagePairs.mockResolvedValueOnce([{a: 0, b: 1, similarity: 0.92}, {a: 1, b: 3, similarity: 0.76}]);
        mergeStories.mockResolvedValueOnce(new Map([['3', '0']]));

        const {news} = await search();

        expect(news).toHaveLength(4);
    });

    it('should not ask the AI when no cards of two languages are close', async () => {
        const {news} = await search();

        expect(mergeStories).not.toHaveBeenCalled();
        expect(news).toHaveLength(4);
    });

    it('should give the cards apart when the AI fails', async () => {
        FeedModel.crossLanguagePairs.mockResolvedValueOnce([{a: 0, b: 1, similarity: 0.92}]);
        mergeStories.mockRejectedValueOnce(new Error('The AI did not answer in JSON.'));

        const {news} = await search();

        expect(news).toHaveLength(4);
    });
});
