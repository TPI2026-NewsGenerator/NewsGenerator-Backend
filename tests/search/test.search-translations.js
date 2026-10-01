//
//  Author: Fabian Rostello
//  Date: 01.10.2026
//  File: test.search-translations.js
//  Description: A search reads every language and shows its cards in the one chosen: the titles and
//               descriptions of the cards written in another are translated, once per text
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {getArticlesByLinks: jest.fn()}}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Html: jest.fn()}}));
jest.unstable_mockModule('../../services/utils/embedder.js', () => ({embed: jest.fn(), toVector: jest.fn(), toSparsevec: jest.fn()}));
jest.unstable_mockModule('../../services/ingest-service.js', () => ({
    searchesOfCategories: jest.fn(async () => []),
    sentenceFeeds: jest.fn(async () => []),
    GOOGLE_ENABLED: jest.fn(() => false),
    IngestService: {readNow: jest.fn()},
}));
jest.unstable_mockModule('../../models/directory-model.js', () => ({DirectoryModel: {feedUrls: jest.fn(async () => [])}}));

const {NewsService} = await import('../../services/news-service.js');
const {FeedModel} = await import('../../models/feed-model.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const article = (link, title, description, lang) => ({link, title, description, lang});
const answer = (...translations) => chat.mockResolvedValueOnce(json({translations}));

beforeEach(() => {
    chat.mockReset();
    FeedModel.getArticlesByLinks.mockReset();
});

describe('translateNews', () => {
    it('should translate the title and description of a card, the title only of a fact, nothing in the language searched', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([
            article('https://kicker.test/1', 'Schiedsrichter pfeift Elfmeter nach Videobeweis', 'Der VAR griff in der 80. Minute ein.', 'de'),
            article('https://marca.test/2', 'El VAR anula el gol del Betis', 'Polémica en el Villamarín.', 'es'),
            article('https://lequipe.test/3', 'La VAR annule le but de Lens', 'Polémique à Bollaert.', 'fr'),
        ]);
        answer('Penalty sifflé après la vidéo', 'Le VAR est intervenu à la 80e minute.', 'Le VAR annule le but du Betis');

        const translations = await NewsService.translateNews({
            news: ['https://kicker.test/1', 'https://lequipe.test/3'], titles: ['https://marca.test/2'], language: 'fr',
        });

        expect(translations).toEqual([
            {url: 'https://kicker.test/1', language: 'de', title: 'Penalty sifflé après la vidéo', description: 'Le VAR est intervenu à la 80e minute.'},
            {url: 'https://marca.test/2', language: 'es', title: 'Le VAR annule le but du Betis', description: null},
        ]);
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('into French');
        expect(prompt).toContain('(German) Schiedsrichter pfeift');
        expect(prompt).not.toContain('Bollaert');
    });

    it('should translate a text once, whatever the search showing it', async () => {
        const news = [article('https://bild.test/4', 'Bayern siegt im Topspiel', null, 'de')];
        FeedModel.getArticlesByLinks.mockResolvedValue(news);
        answer('Bayern wins the big game');

        await NewsService.translateNews({news: ['https://bild.test/4'], language: 'en'});
        const again = await NewsService.translateNews({news: ['https://bild.test/4'], language: 'en'});

        expect(again).toEqual([{url: 'https://bild.test/4', language: 'de', title: 'Bayern wins the big game', description: null}]);
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('should read the language of a news without vectors from its text', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([
            article('https://gazzetta.test/5', "L'arbitro ha annullato il gol della Juventus", "Polemica per la decisione del VAR durante la partita di ieri sera", null),
        ]);
        answer("L'arbitre a annulé le but de la Juventus", "Polémique sur la décision du VAR pendant le match d'hier soir");

        const [translation] = await NewsService.translateNews({news: ['https://gazzetta.test/5'], language: 'fr'});

        expect(translation.language).toBe('it');
    });

    it('should refuse a news that is not in the cache', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([]);

        await expect(NewsService.translateNews({news: ['https://any.test/text'], language: 'fr'}))
            .rejects.toMatchObject({status: 400});
        expect(chat).not.toHaveBeenCalled();
    });
});
