//
//  Author: Fabian Rostello
//  Date: 30.09.2026
//  File: test.search-google.js
//  Description: A news of Google News in a search: shown under its publisher, and read at its real
//               address for the key passages
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const GOOGLE_FEED = 'https://news.google.com/rss/search?q=cartes%20Pok%C3%A9mon&hl=fr&gl=FR&ceid=FR:fr';
const google = (id, title) => ({
    id, id_feed: 2, link: `https://news.google.com/rss/articles/${id}`, title, description: '', thumbnail: null,
    published_at: new Date(Date.UTC(2026, 8, 28, 12)), source_url: 'https://www.numerama.com', resolved_link: null,
    medium: 'numerama.com', id_story: null, id_thread: null, feeds: {url: GOOGLE_FEED},
});

jest.unstable_mockModule('../../models/feed-model.js', () => ({
    FeedModel: {
        searchArticles: jest.fn(),
        publicFeedUrls: jest.fn(async () => []),
        similarArticlePairs: jest.fn(async () => []),
        threadArticles: jest.fn(async () => []),
        getArticlesByLinks: jest.fn(),
        trustedFeedUrls: jest.fn(async () => []),
        saveResolvedLinks: jest.fn(async () => 1),
        saveExtract: jest.fn(),
        saveTranslation: jest.fn(),
    },
}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: jest.fn()}}));
jest.unstable_mockModule('../../services/utils/extract.js', () => ({
    canSummarize: (text) => Boolean(text),
    extractArticle: jest.fn(async () => ({passages: ['La phrase.'], translation: null, topic: 'jeux', sourcing: 'named'})),
    passagesText: (passages) => passages?.join('\n') ?? null,
    translationFor: jest.fn(),
}));
jest.unstable_mockModule('../../services/utils/google-news.js', () => ({
    decodeLinks: jest.fn(async (links) => new Map(links.map(link => [link, 'https://www.numerama.com/cartes-pokemon']))),
    isGoogleNewsUrl: (url) => url.startsWith('https://news.google.com/'),
    googleAvailable: () => true,
    sentenceUrl: () => null,
}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({
    searchesOfCategories: jest.fn(async () => []),
    GOOGLE_ENABLED: () => false,
    IngestService: {readNow: jest.fn()},
}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {feedUrls: jest.fn(async () => [])}}));

const {NewsService} = await import('../../services/news-service.js');
const {FeedModel} = await import('../../models/feed-model.js');
const {Crawlers} = await import('../../services/utils/crawlers.js');
const {decodeLinks} = await import('../../services/utils/google-news.js');

beforeEach(() => jest.clearAllMocks());

describe('a news of Google News in a search', () => {
    it('should be shown under its publisher, not news.google.com', async () => {
        FeedModel.searchArticles.mockResolvedValue([google(1, 'Dans 1 mois, 15 cartes du TCG Pokémon offertes')]);

        const {news} = await NewsService.getNews({keywords: ['"Pokémon"'], category: ['technology'], language: 'fr'});

        expect(news[0].source).toBe('numerama.com');
        expect(news[0].url).toBe('https://news.google.com/rss/articles/1');
    });

    it('should be read at its real address for the key passages, found once', async () => {
        const article = google(1, 'Dans 1 mois, 15 cartes du TCG Pokémon offertes');
        FeedModel.getArticlesByLinks.mockResolvedValue([article]);
        Crawlers.Html.mockResolvedValue([{url: 'https://www.numerama.com/cartes-pokemon', content: 'Le texte entier.'}]);

        const [card] = await NewsService.summarizeStories([{urls: [article.link]}], {language: 'fr'});

        expect(decodeLinks).toHaveBeenCalledWith([article.link]);
        expect(Crawlers.Html).toHaveBeenCalledWith([{url: 'https://www.numerama.com/cartes-pokemon'}]);
        expect(FeedModel.saveResolvedLinks).toHaveBeenCalledWith([{link: article.link, resolved: 'https://www.numerama.com/cartes-pokemon'}]);
        expect(card.summary).toBe('La phrase.');
        expect(card.articles[0].source).toBe('numerama.com');
    });

    it('should say when Google did not give the address of a news it alone knows', async () => {
        const article = google(2, 'Cambriolage éclair pour des cartes Pokémon');
        FeedModel.getArticlesByLinks.mockResolvedValue([article]);
        decodeLinks.mockResolvedValueOnce(new Map());
        Crawlers.Html.mockResolvedValue([]);

        const [card] = await NewsService.summarizeStories([{urls: [article.link]}], {language: 'fr'});

        expect(Crawlers.Html).toHaveBeenCalledWith([]);
        expect(card.summary).toBeNull();
        expect(card.summaryError).toMatch(/Google News/);
    });
});
