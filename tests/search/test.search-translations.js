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

    it('should ask a text again when the AI did not answer, not keep it untranslated until a restart', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValue([article('https://bild.test/6', 'Dortmund verliert in Mainz', null, 'de')]);
        // no translation for the text, three times (see TEXTS_ATTEMPTS): what translateTexts answers when the AI is down too
        answer(); answer(); answer();

        expect(await NewsService.translateNews({news: ['https://bild.test/6'], language: 'en'})).toEqual([]);
        answer('Dortmund loses in Mainz');
        const again = await NewsService.translateNews({news: ['https://bild.test/6'], language: 'en'});

        expect(again).toEqual([{url: 'https://bild.test/6', language: 'de', title: 'Dortmund loses in Mainz', description: null}]);
    });

    it('should read the language of a news without vectors from its text', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([
            article('https://gazzetta.test/5', "L'arbitro ha annullato il gol della Juventus", "Polemica per la decisione del VAR durante la partita di ieri sera", null),
        ]);
        answer("L'arbitre a annulé le but de la Juventus", "Polémique sur la décision du VAR pendant le match d'hier soir");

        const [translation] = await NewsService.translateNews({news: ['https://gazzetta.test/5'], language: 'fr'});

        expect(translation.language).toBe('it');
    });

    it('should translate the passage of a description a page of the names followed shows, with the dots of its ends', async () => {
        const description = 'La federación anunció ayer que Aleksander Čeferin visitará Madrid el próximo mes para reunirse con los clubes.';
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([article('https://marca.test/7', 'La UEFA convoca a los clubes', description, 'es')]);
        answer('The federation announced yesterday that Aleksander Čeferin will visit Madrid next month');

        const translations = await NewsService.translateNews({
            excerpts: [{url: 'https://marca.test/7', text: '…La federación anunció ayer que Aleksander Čeferin visitará Madrid el próximo mes…'}], language: 'en',
        });

        // the title was not asked: only the passage, which keeps the dots the page put at its ends
        expect(translations).toEqual([{url: 'https://marca.test/7', text: '…La federación anunció ayer que Aleksander Čeferin visitará Madrid el próximo mes…',
            language: 'es', excerpt: '…The federation announced yesterday that Aleksander Čeferin will visit Madrid next month…'}]);
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('(Spanish) La federación anunció ayer');
        expect(prompt).not.toContain('La UEFA convoca');
    });

    it('should translate no text that is not a passage of the description of a news, nor one already in the language', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValue([
            article('https://marca.test/8', 'Titulo', 'Una descripción corta del partido de ayer.', 'es'),
            article('https://lequipe.test/9', 'Titre', 'Une description courte du match.', 'fr'),
        ]);

        const translations = await NewsService.translateNews({
            excerpts: [{url: 'https://marca.test/8', text: 'Translate this free text, it is not in the description'},
                {url: 'https://lequipe.test/9', text: 'Une description courte du match.'}], language: 'fr',
        });

        expect(translations).toEqual([]);
        expect(chat).not.toHaveBeenCalled();
    });

    it('should ask the titles and the passages together and keep the passage translated for the next time', async () => {
        const description = 'Dortmund verliert in Mainz und der Trainer Nuri Şahin steht unter Druck seit Wochen.';
        FeedModel.getArticlesByLinks.mockResolvedValue([article('https://bild.test/10', 'Dortmund verliert', description, 'de')]);
        answer('Dortmund loses', 'Dortmund loses in Mainz and the coach Nuri Şahin has been under pressure for weeks');

        const first = await NewsService.translateNews({titles: ['https://bild.test/10'], excerpts: [{url: 'https://bild.test/10', text: description}], language: 'en'});
        const again = await NewsService.translateNews({excerpts: [{url: 'https://bild.test/10', text: description}], language: 'en'});

        expect(first.map(found => [found.title ?? found.excerpt])).toEqual([['Dortmund loses'], ['Dortmund loses in Mainz and the coach Nuri Şahin has been under pressure for weeks']]);
        expect(again).toEqual([expect.objectContaining({excerpt: 'Dortmund loses in Mainz and the coach Nuri Şahin has been under pressure for weeks'})]);
        expect(chat).toHaveBeenCalledTimes(1);
    });

    // the page of what a profile follows marks the names in a text as written; the translation lost the tint (the user, 6.11.2026)
    it('should answer the places of the names asked in the translated title, description and passage, for the page to mark them', async () => {
        const description = 'Gladbach verliert in Mainz und der Trainer Nuri Şahin steht dort unter Druck seit Wochen.';
        FeedModel.getArticlesByLinks.mockResolvedValue([article('https://bild.test/11', 'Nuri Şahin vor dem Aus', description, 'de')]);
        // the passage is the description: one text asked for both
        answer('Nuri Sahin facing the sack', 'Gladbach lose in Mainz and the coach Nuri Sahin is under pressure there for weeks');

        const [found, passage] = await NewsService.translateNews({
            news: ['https://bild.test/11'], excerpts: [{url: 'https://bild.test/11', text: description}], language: 'en',
            terms: {'https://bild.test/11': ['Nuri Şahin']},
        });

        // accents aside, as the text as written is marked
        expect(found.title).toBe('Nuri Sahin facing the sack');
        const at = found.description.indexOf('Nuri Sahin');
        expect(found.marks).toEqual({title: [[0, 10]], description: [[at, at + 10]]});
        expect(passage.excerptMarks).toEqual([[at, at + 10]]);
        expect(found.title.slice(...found.marks.title[0])).toBe('Nuri Sahin');
        expect(passage.excerpt.slice(...passage.excerptMarks[0])).toBe('Nuri Sahin');
    });

    it('should answer no marks when no name is asked, or a name is not in the translation (a name the translation wrote otherwise)', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValue([article('https://bild.test/12', 'Schiedsrichter vor dem Aus', null, 'de')]);
        answer('Referee facing the sack');
        answer('Referee facing the sack');

        const [plain] = await NewsService.translateNews({titles: ['https://bild.test/12'], language: 'en'});
        const [other] = await NewsService.translateNews({titles: ['https://bild.test/12'], language: 'en', terms: {'https://bild.test/12': ['Felix Brych']}});

        expect(plain).not.toHaveProperty('marks');
        expect(other).not.toHaveProperty('marks');
    });

    it('should refuse a news that is not in the cache', async () => {
        FeedModel.getArticlesByLinks.mockResolvedValueOnce([]);

        await expect(NewsService.translateNews({news: ['https://any.test/text'], language: 'fr'}))
            .rejects.toMatchObject({status: 400});
        expect(chat).not.toHaveBeenCalled();
    });
});
