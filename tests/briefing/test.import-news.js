//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.import-news.js
//  Description: A news the reader adds to a ready briefing by its link: its page read, its passages
//               chosen and translated as a card's, added at the end with a negative id, and sent by
//               e-mail with the cards; a page already in the briefing, unreadable or private refused
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const ofUser = jest.fn();
const addItem = jest.fn(async () => -1);
const removeItem = jest.fn(async () => 1);
const cardOfLinks = jest.fn(async () => null);
const addAnalysisLines = jest.fn(async () => 1);
const sendMail = jest.fn(async () => {});
const pages = jest.fn();
const extractArticle = jest.fn();
const translateTexts = jest.fn(async () => ['Grève des trains']);
const lookup = jest.fn(async () => [{address: '93.184.215.14', family: 4}]);
jest.unstable_mockModule('node:dns/promises', () => ({default: {lookup}, lookup}));
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
// what the profile follows: its words only
jest.unstable_mockModule('../../services/entity-service.js', () => ({EntityService: {
    followTerms: async (profileId, words) => (words ?? []).map(word => ({label: word, qid: null, names: [word]})),
}}));
const startAnalysisOfAdded = jest.fn(async () => 1);
const finishAnalysisOfAdded = jest.fn(async () => 1);
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel: {ofUser, addItem, removeItem, cardOfLinks, addAnalysisLines, startAnalysisOfAdded, finishAnalysisOfAdded,
    articlePictures: jest.fn(async () => []), markSent: jest.fn(async () => 1)}}));
// the news we hold, and the steps of a briefing a news added goes through (see importedCardOf): the AI, Wikidata and the network are not asked
const articlesOfLinks = jest.fn(async () => []);
const storyArticles = jest.fn(async () => []);
jest.unstable_mockModule('../../models/story-model.js', () => ({StoryModel: {articlesOfLinks, storyArticles, earlierInThreads: jest.fn(async () => [])}}));
const ollama = await import('../../services/utils/ollama.js');
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({...ollama, ollamaJson: jest.fn(async () => ({}))}));
jest.unstable_mockModule('../../services/utils/contested.js', () => ({contestedOf: jest.fn(async () => []), shownDenials: jest.fn(denials => denials ?? []), withoutDenied: jest.fn(posts => posts)}));
jest.unstable_mockModule('../../services/utils/card-spellings.js', () => ({glossariesOfStories: jest.fn(async () => new Map()), labelsOfItems: jest.fn(async () => new Map()), withoutUntrustedLabels: (card) => card}));
const namesAndCountriesOfCards = jest.fn(async (cards) => new Map(cards.map(card => [card.storyId, {names: [{name: 'SBB', qid: 'Q1', kind: 'organization'}], countries: ['CH']}])));
jest.unstable_mockModule('../../services/utils/card-names.js', () => ({namesAndCountriesOfCards}));
const officialSourcesOf = jest.fn(async (cards) => new Map(cards.map(card => [card.id, [{party: 'SBB', title: 'Statement', url: 'https://sbb.example/s', channel: 'website'}]])));
jest.unstable_mockModule('../../services/utils/official-sources.js', () => ({officialSourcesOf}));
jest.unstable_mockModule('../../services/utils/illustrations.js', () => ({illustrationsOf: jest.fn(async () => new Map())}));
jest.unstable_mockModule('../../services/utils/picture-sizes.js', () => ({sizesOf: jest.fn(async () => new Map()), whyNotShown: jest.fn(async () => null), SHARP_WIDTH: 560, PICTURE_HEADERS: {}, isStanding: () => false}));
const analysesOf = jest.fn(async (cards) => ({picked: cards.map(card => ({storyId: card.storyId, reason: 'a decisive news'})),
    cards: Object.fromEntries(cards.map(card => [card.storyId, {why: ['Why it matters.'], next: [], dropped: 0}]))}));
const cardAnalysis = await import('../../services/utils/card-analysis.js');
jest.unstable_mockModule('../../services/utils/card-analysis.js', () => ({...cardAnalysis, analysesOf}));
jest.unstable_mockModule('../../models/user-model.js', () => ({UserModel: {email: jest.fn(async () => ({email: 'reader@example.test', username: 'lecteur'}))}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: jest.fn(async () => ({name: 'Roberto', text: 'Je lis en français.', languages: ['fr'], watch_terms: ['SBB']}))}}));
jest.unstable_mockModule('../../services/utils/mailer.js', () => ({sendMail, mailEnabled: () => true}));
jest.unstable_mockModule('../../services/utils/crawlers.js', () => ({Crawlers: {Pages: pages, Html: pages}}));
const aiWaysOf = jest.fn(async () => null);
jest.unstable_mockModule('../../services/utils/ai-ways.js', () => ({aiWaysOf}));
const extract = await import('../../services/utils/extract.js');
// the titles are translated by translateTextsSure (translateTexts and a second round): the mock answers both
jest.unstable_mockModule('../../services/utils/extract.js', () => ({...extract, extractArticle, translateTexts, translateTextsSure: translateTexts}));
const {BriefingService, completeCards, withoutTracking} = await import('../../services/briefing-service.js');
const {ollamaJson} = await import('../../services/utils/ollama.js');

// the cards the people and organisations were asked for, from the last call
const namesAndCardsAsked = () => namesAndCountriesOfCards.mock.calls.at(-1)[0];
const card = (storyId, url) => ({storyId, title: `Story ${storyId}`, summary: 'A passage.', lead: {source: 'media.fr', url, language: 'fr'}, articles: []});
const row = {id: 7, id_profile: 3, status: 'ready', hours: 24, finished_at: new Date('2026-10-13T06:00:00Z'), items: [card(1, 'https://media.fr/1')]};
const page = {url: 'https://news.example/strike', title: 'SBB: train strike on Monday', description: 'Trains stop.', thumbnail: 'https://news.example/p.jpg',
    publishedAt: '2026-10-13T05:00:00Z', blocks: [],
    // a page in English, whose language the card is said to be written in
    content: 'The trains of the Swiss railways will stop on Monday because of a strike by the staff of the company. '.repeat(10)};

beforeEach(() => {
    ofUser.mockReset().mockResolvedValue(row);
    addItem.mockClear();
    articlesOfLinks.mockReset().mockResolvedValue([]);
    storyArticles.mockReset().mockResolvedValue([]);
    namesAndCountriesOfCards.mockClear();
    startAnalysisOfAdded.mockReset().mockResolvedValue(1);
    finishAnalysisOfAdded.mockReset().mockResolvedValue(1);
    analysesOf.mockClear();
    cardOfLinks.mockReset().mockResolvedValue(null);
    addAnalysisLines.mockClear();
    sendMail.mockClear();
    pages.mockReset().mockResolvedValue([page]);
    extractArticle.mockReset().mockResolvedValue({
        passages: [[{text: 'Trains will stop on Monday.'}]], translation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        points: [[{text: 'Trains will stop on Monday.'}]], pointsTranslation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        digest: [[{text: 'Trains will stop on Monday.'}]], digestTranslation: [[{text: 'Les trains s’arrêteront lundi.'}]],
        from: 'en', topic: 'transport', sourcing: 'named',
    });
});

describe('BriefingService.importNews', () => {
    it('should read the page, choose and translate its passages as a card, and add it at the end with its id', async () => {
        const {item, analysis} = await BriefingService.importNews(4, '7', ' https://news.example/strike ');

        expect(pages).toHaveBeenCalledWith(['https://news.example/strike']);
        expect(extractArticle).toHaveBeenCalledWith('SBB: train strike on Monday', page, expect.objectContaining({language: 'fr'}));
        const [userId, briefingId, added, conditions] = addItem.mock.calls[0];
        expect([userId, briefingId]).toEqual([4, 7]);
        // checked again by the statement that adds it
        expect(conditions).toEqual({max: 10, links: ['https://news.example/strike']});
        expect(added).toMatchObject({
            imported: true, title: 'SBB: train strike on Monday', titleTranslation: 'Grève des trains', language: 'en',
            summary: 'Trains will stop on Monday.', translation: 'Les trains s’arrêteront lundi.', topic: 'transport',
            lead: {url: 'https://news.example/strike', source: 'news.example', publishedAt: '2026-10-13T05:00:00.000Z'},
            why: null, interest: null, contested: [], vote: null, followUp: null, feedUrls: [], mergedStoryIds: [],
        });
        // the steps of a briefing: the people and organisations it names with their countries, the official sources of its parties, the
        // media that tell it (one: a page of another site), the key passages of the page read
        expect(added).toMatchObject({names: [{name: 'SBB', qid: 'Q1', kind: 'organization'}], countries: ['CH'],
            official: [{party: 'SBB', title: 'Statement'}], corroboration: {media: 1}});
        expect(added.angles).toEqual([]);
        // a page of another site is the story of its own page: no story of ours, the id of the card is the next negative one
        expect(namesAndCardsAsked().map(card => card.storyId)).toEqual([-1]);
        expect(item.storyId).toBe(-1);
        // the terms the profile follows marked in it
        expect(item.marks.title).toEqual([[0, 3]]);
        // nothing was looked for in the other briefings but a card, and none came with an analysis from there
        expect(cardOfLinks).toHaveBeenCalledWith(4, 7, ['https://news.example/strike', 'https://news.example/strike/'], 7);
        expect(analysis).toBeNull();
        expect(addAnalysisLines).not.toHaveBeenCalled();
    });

    describe('the last read of the AI (proofread.js)', () => {
        const dated = 'GENÈVE – Les trains s’arrêteront lundi dans toute la Suisse à cause d’une grève du personnel.';
        const bare = 'Les trains s’arrêteront lundi dans toute la Suisse à cause d’une grève du personnel.';
        const proofreadPrompt = (prompt) => typeof prompt === 'string' && prompt.includes('You proofread the cards');
        const datedExtract = () => extractArticle.mockResolvedValue({
            passages: [[{text: 'Trains will stop on Monday.'}]], translation: [[{text: dated}]], points: [[{text: 'Trains will stop on Monday.'}]], pointsTranslation: [[{text: dated}]],
            digest: [[{text: 'Trains will stop on Monday.'}]], digestTranslation: [[{text: dated}]], from: 'en', topic: 'transport', sourcing: 'named',
        });
        afterEach(() => ollamaJson.mockReset().mockImplementation(async () => ({})));

        it('should take out the dateline the AI points at in the news a reader adds, as it does for the cards of a briefing', async () => {
            datedExtract();
            ollamaJson.mockImplementation(async (prompt) => proofreadPrompt(prompt) ? {cards: [{id: 1, problems: [{field: 'passages 1', kind: 'dateline', text: 'GENÈVE –'}]}]} : {});

            await BriefingService.importNews(4, '7', 'https://news.example/strike');

            const [, , added] = addItem.mock.calls[0];
            expect([added.translation, added.pointsTranslation, added.digestTranslation]).toEqual([bare, bare, bare]);
            expect(added.proofread).toEqual([{kind: 'dateline', text: 'GENÈVE –', fields: ['passages', 'points', 'digest']}]);
            // the card was shown to the AI in the language of the reader
            expect(ollamaJson.mock.calls.find(([prompt]) => proofreadPrompt(prompt))[0]).toContain('shown in French');
        });

        it('should leave out of the names of the news a reader adds the ones with no item that the AI says are no names, as for a briefing', async () => {
            namesAndCountriesOfCards.mockImplementationOnce(async (cards) => new Map(cards.map(one => [one.storyId, {names: [{name: 'SBB', qid: 'Q1', kind: 'organization'},
                {name: 'Hotline', qid: null, kind: 'organization'}, {name: 'Valencia', qid: null, kind: 'organization'}], countries: ['CH']}])));
            ollamaJson.mockImplementation(async (prompt) => typeof prompt === 'string' && prompt.includes('NOT the proper name of a person') ? {not_names: [{n: 1, why: 'common noun'}]} : {});

            await BriefingService.importNews(4, '7', 'https://news.example/strike');

            const [, , added] = addItem.mock.calls[0];
            expect(added.names.map(name => name.name)).toEqual(['SBB', 'Valencia']);
            expect(added.namesLeftOut).toEqual([{name: 'Hotline', why: 'common noun'}]);
        });

        it('should add the news as it is when the AI fails to read it', async () => {
            datedExtract();
            ollamaJson.mockImplementation(async (prompt) => {
                if (proofreadPrompt(prompt)) throw new Error('down');
                return {};
            });

            await BriefingService.importNews(4, '7', 'https://news.example/strike');

            const [, , added] = addItem.mock.calls[0];
            expect(added.translation).toBe(dated);
            expect(added.proofread).toBeUndefined();
        });
    });

    it('should read the news with the story it is in, and the media that tell it, when we hold it', async () => {
        const held = (id, link, extra = {}) => ({id, id_story: 55, link, title: `SBB strike ${id}`, description: 'Trains stop.', thumbnail: null, lang: 'en',
            feed_url: 'https://feed.example/rss', medium: 'x', source_url: null, resolved_link: null, at: new Date('2026-10-13T05:00:00Z'), ...extra});
        articlesOfLinks.mockResolvedValue([held(101, 'https://news.example/strike')]);
        storyArticles.mockResolvedValue([held(102, 'https://other.example/sbb'), held(101, 'https://news.example/strike')]);
        pages.mockImplementation(async (urls) => urls.map(url => ({...page, url})));

        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');

        // the story of the news at that address, over a week, in the feeds of the reader
        expect(storyArticles).toHaveBeenCalledWith(expect.objectContaining({storyIds: [55]}));
        const [, , added, conditions] = addItem.mock.calls[0];
        // read first: the news added is the lead of the card; the card has the story's media and all its links looked for in the briefing
        expect(added.lead.url).toBe('https://news.example/strike');
        expect(added.articles.map(article => article.url).sort()).toEqual(['https://news.example/strike', 'https://other.example/sbb']);
        expect(added.corroboration.mediaNames.sort()).toEqual(['news.example', 'other.example']);
        expect(conditions.links).toEqual(expect.arrayContaining(['https://news.example/strike', 'https://other.example/sbb']));
        // the people it names are those of its story, by its articles: both
        expect(namesAndCardsAsked().map(asked => [asked.storyId, [...asked.ids].sort()])).toEqual([[55, [101, 102]]]);
        expect(item.storyId).toBe(-1);
    });

    it('should refuse another article of a story that is a card of this briefing already', async () => {
        articlesOfLinks.mockResolvedValue([{id: 101, id_story: 55, link: 'https://news.example/strike', title: 'SBB strike', description: '', thumbnail: null, lang: 'en',
            feed_url: 'https://feed.example/rss', medium: 'x', source_url: null, resolved_link: null, at: new Date('2026-10-13T05:00:00Z')}]);
        storyArticles.mockResolvedValue([{id: 102, id_story: 55, link: 'https://media.fr/1', title: 'The same strike', description: '', thumbnail: null, lang: 'fr',
            feed_url: 'https://feed.example/rss', medium: 'x', source_url: null, resolved_link: null, at: new Date('2026-10-13T05:00:00Z')}]);
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 409});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should write its analysis after the answer, and tell the page to ask for it', async () => {
        const answer = await BriefingService.importNews(4, 7, 'https://news.example/strike');

        expect(answer.analyzing).toBe(true);
        expect(startAnalysisOfAdded).toHaveBeenCalledWith(4, 7, -1);
        // written after the answer, saved with the id of the card in the briefing
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(analysesOf).toHaveBeenCalledTimes(1);
        expect(finishAnalysisOfAdded).toHaveBeenCalledWith(4, 7, -1, {why: ['Why it matters.'], next: [], timeline: []});
    });

    it('should leave the card without analysis when the briefing is not ready for one, or the AI finds it merits none', async () => {
        startAnalysisOfAdded.mockResolvedValueOnce(0);
        expect((await BriefingService.importNews(4, 7, 'https://news.example/strike')).analyzing).toBe(false);
        expect(finishAnalysisOfAdded).not.toHaveBeenCalled();

        analysesOf.mockResolvedValueOnce({picked: [], cards: {}});
        await BriefingService.importNews(4, 7, 'https://news.example/strike');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(finishAnalysisOfAdded).toHaveBeenCalledWith(4, 7, -1, null);
    });

    it('should add the news without the people it names when that step fails, rather than lose it', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        namesAndCountriesOfCards.mockRejectedValueOnce(new Error('wikidata down'));
        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(item.imported).toBe(true);
        expect(item.names).toEqual([]);
        expect(item.summary).toBe('Trains will stop on Monday.');
        error.mockRestore();
    });

    it('should refuse a news already on a card, a private address, and a page with no article, adding nothing', async () => {
        await expect(BriefingService.importNews(4, 7, 'https://media.fr/1')).rejects.toMatchObject({status: 409});
        await expect(BriefingService.importNews(4, 7, 'file:///etc/passwd')).rejects.toMatchObject({status: 400});
        lookup.mockResolvedValueOnce([{address: '192.168.1.135', family: 4}]);
        await expect(BriefingService.importNews(4, 7, 'https://intranet.example/a')).rejects.toMatchObject({status: 400});
        pages.mockResolvedValueOnce([]);
        await expect(BriefingService.importNews(4, 7, 'https://news.example/paywall')).rejects.toMatchObject({status: 422});
        await expect(BriefingService.importNews(4, 7, '')).rejects.toMatchObject({status: 400});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should not ask the AI versions of a page that gives no passage of a news', async () => {
        aiWaysOf.mockClear();
        extractArticle.mockResolvedValueOnce({passages: [], translation: null, points: [], pointsTranslation: null, digest: [], digestTranslation: null,
            from: null, topic: null, sourcing: null});

        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 422});
        expect(aiWaysOf).not.toHaveBeenCalled();
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should refuse an eleventh news added to one briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [...row.items, ...Array.from({length: 10}, (_, i) => ({...card(-i - 1, `https://x.example/${i}`), imported: true}))]});
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 400});
    });

    it('should say why when the same news, added at the same time, was added first', async () => {
        addItem.mockResolvedValueOnce(null);
        ofUser.mockResolvedValueOnce(row).mockResolvedValueOnce({...row, items: [...row.items, {...card(-1, 'https://news.example/strike'), imported: true}]});

        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 409});
    });
});

describe('BriefingService.importNews of a news another briefing of the reader has', () => {
    // the card as the briefing of another profile wrote it, with its analysis
    const lines = {why: ['A decisive week for the federation.'], next: [{if: 'it votes', then: 'a president is chosen'}], timeline: []};
    const other = {
        storyId: 1701277, title: 'Galliani backed', titleTranslation: null, language: 'en', topic: 'sport', summary: 'Galliani is backed.', translation: '',
        why: 'Chosen for Enzo.', interest: 'Federations', project: 'A project', vote: 'up', sentAt: '2026-10-30T08:00:00Z', followUp: {storyId: 5},
        feedUrls: ['https://feed.example/rss'], mergedStoryIds: [9], ai: {points: ['One.'], summary: 'Two.', model: 'm'},
        lead: {url: 'https://news.example/strike', source: 'news.example', language: 'en'}, articles: [{url: 'https://news.example/strike'}, {url: 'https://other.example/a'}],
        angles: [{title: 'Another angle', url: 'https://angle.example/1'}], official: [{party: 'FIGC', title: 'Statement'}], contested: [],
        corroboration: {media: 3}, names: [{name: 'Galliani', qid: null, kind: 'human'}], thumbnail: 'https://news.example/p.jpg',
    };
    beforeEach(() => cardOfLinks.mockResolvedValue({briefingId: 5, idProfile: 3, card: other, lines}));

    it('should copy its card with its angles, official sources and analysis instead of reading the page', async () => {
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');

        expect(pages).not.toHaveBeenCalled();
        expect(extractArticle).not.toHaveBeenCalled();
        const [, , added, conditions] = addItem.mock.calls[0];
        // every article of the card is looked for in this briefing, not only the address pasted
        expect(conditions.links).toEqual(expect.arrayContaining(['https://news.example/strike', 'https://other.example/a']));
        expect(added).toMatchObject({
            imported: true, transferred: true, title: 'Galliani backed', angles: other.angles, official: other.official, ai: other.ai,
            corroboration: {media: 3}, names: other.names, thumbnail: 'https://news.example/p.jpg',
            // what was for the other profile only
            why: null, interest: null, project: null, vote: null, followUp: null, feedUrls: [], mergedStoryIds: [],
        });
        expect(added.storyId).toBeUndefined();
        expect(added.sentAt).toBeUndefined();
        // its analysis lines are saved for this briefing's card, and given to the page
        expect(addAnalysisLines).toHaveBeenCalledWith(4, 7, -1, lines);
        expect(analysis).toEqual(lines);
        expect(item).toMatchObject({storyId: -1, angles: other.angles, official: other.official});
    });

    it('should copy the card alone when the analysis of this briefing is not written', async () => {
        addAnalysisLines.mockResolvedValueOnce(0);
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(item.angles).toMatchObject(other.angles);
        expect(analysis).toBeNull();
    });

    it('should copy the card without lines when the other briefing has none for it', async () => {
        cardOfLinks.mockResolvedValue({briefingId: 5, idProfile: 3, card: other, lines: null});
        const {item, analysis} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(item.official).toEqual(other.official);
        expect(analysis).toBeNull();
        expect(addAnalysisLines).not.toHaveBeenCalled();
    });

    it('should read the page when the other briefing was written for a reader of another language', async () => {
        const { ProfileModel } = await import('../../models/profile-model.js');
        ProfileModel.get.mockResolvedValueOnce({name: 'Roberto', text: '', languages: ['fr'], watch_terms: []})
            .mockResolvedValueOnce({name: 'Enzo', text: '', languages: ['en'], watch_terms: []});
        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(pages).toHaveBeenCalled();
        expect(item.transferred).toBeUndefined();
        expect(addAnalysisLines).not.toHaveBeenCalled();
    });

    it('should refuse it when one of its articles is already on a card of this briefing', async () => {
        ofUser.mockResolvedValue({...row, items: [card(1, 'https://other.example/a')]});
        await expect(BriefingService.importNews(4, 7, 'https://news.example/strike')).rejects.toMatchObject({status: 409});
        expect(addItem).not.toHaveBeenCalled();
    });

    it('should read the page when the search of the other briefings fails', async () => {
        cardOfLinks.mockRejectedValue(new Error('db down'));
        const {item} = await BriefingService.importNews(4, 7, 'https://news.example/strike');
        expect(pages).toHaveBeenCalled();
        expect(item.imported).toBe(true);
    });
});

describe('withoutTracking', () => {
    it('should take out what only tells where the reader came from, and keep what tells the page', () => {
        expect(withoutTracking('https://news.example/strike?utm_source=x&utm_medium=post&fbclid=abc#comments')).toBe('https://news.example/strike');
        expect(withoutTracking('https://news.example/read?id=5&utm_campaign=y')).toBe('https://news.example/read?id=5');
        expect(withoutTracking('https://news.example/strike')).toBe('https://news.example/strike');
        expect(withoutTracking('not an address')).toBe('not an address');
    });

    it('should look for our news at the address without tracking too, so a link pasted from a post finds its story', async () => {
        pages.mockImplementation(async (urls) => urls.map(url => ({...page, url})));
        await BriefingService.importNews(4, 7, 'https://news.example/strike?utm_source=x');
        expect(articlesOfLinks.mock.calls[0][0]).toEqual(expect.arrayContaining(['https://news.example/strike?utm_source=x', 'https://news.example/strike']));
    });
});

describe('BriefingService.removeNews', () => {
    it('should take out a news added, never a card of the briefing', async () => {
        await BriefingService.removeNews(4, '7', '-1');
        expect(removeItem).toHaveBeenCalledWith(4, 7, -1);
        await expect(BriefingService.removeNews(4, 7, '1')).rejects.toMatchObject({status: 404});
        removeItem.mockResolvedValueOnce(0);
        await expect(BriefingService.removeNews(4, 7, '-9')).rejects.toMatchObject({status: 404});
    });
});

describe('BriefingService.email with a news added', () => {
    it('should send the news added with the cards ticked, by its negative id', async () => {
        ofUser.mockResolvedValue({...row, items: [...row.items, {...card(-1, 'https://news.example/strike'), title: 'Added news', imported: true}]});
        // the words of the e-mail in the reader's language, French here
        const french = {'{name}’s Briefing': 'Le briefing de {name}', '{count} stories': '{count} nouvelles'};
        translateTexts.mockImplementationOnce(async (texts) => texts.map(({text}) => french[text] ?? null));
        await BriefingService.email(4, 7, [-1, 1]);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.text.indexOf('01. Added news')).toBeGreaterThan(0);
        expect(mail.subject).toBe('Le briefing de Roberto · 13 octobre 2026 · 2 nouvelles');
    });
});

describe('completeCards, a title that could not be translated', () => {
    const lead = {id: 1, id_story: 55, link: 'https://news.example/strike', title: 'SBB: train strike on Monday', description: '', thumbnail: null, lang: 'en',
        feed_url: 'https://feed.example/rss', medium: 'news.example', source_url: null, resolved_link: null, at: new Date('2026-10-13T05:00:00Z')};
    const story = () => ({storyId: 55, best: lead, lead, members: [lead], mergedStoryIds: []});
    const usage = () => Object.fromEntries(['summarizing', 'contesting', 'reviewing', 'angles', 'official', 'naming', 'titling', 'titleRewriting', 'writing']
        .map(step => [step, {calls: 0, input: 0, output: 0}]));

    it('should leave out the card of a briefing whose title stays in its language even asked again, and keep a news the reader added', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        translateTexts.mockResolvedValueOnce([null]);
        const {items} = await completeCards({main: [story()]}, {label: 'test', usage: usage(), language: 'fr', review: false});
        expect(items).toEqual([]);
        expect(error.mock.calls.flat().join(' ')).toContain('its title could not be translated');

        translateTexts.mockResolvedValueOnce([null]);
        const kept = await completeCards({main: [story()]}, {label: 'test', usage: usage(), language: 'fr', review: false, dropUntranslated: false});
        expect(kept.items).toHaveLength(1);
        expect(kept.items[0].titleTranslation).toBeNull();

        // a title translated is a card kept
        const done = await completeCards({main: [story()]}, {label: 'test', usage: usage(), language: 'fr', review: false});
        expect(done.items).toHaveLength(1);
        expect(done.items[0].titleTranslation).toBe('Grève des trains');
        error.mockRestore();
    });
});
