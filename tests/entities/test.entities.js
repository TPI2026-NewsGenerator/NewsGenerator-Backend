//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.entities.js
//  Description: The clubs, people and organisations of Wikidata: the names their news are found by, and
//               the page of one, its news and the ones of what it is linked to
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const EntityModel = {
    byQid: jest.fn(), save: jest.fn(async () => 1), links: jest.fn(async () => []), following: jest.fn(async () => null),
    followed: jest.fn(async () => []), count: jest.fn(async () => 0), follow: jest.fn(), unfollow: jest.fn(async () => 1), setNames: jest.fn(),
};
const articlesHolding = jest.fn(async () => []);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/entity-model.js', () => ({EntityModel}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {articlesHolding}}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel: {get: async () => ({text: 'Le football', languages: ['fr']})}}));
jest.unstable_mockModule('../../services/briefing-service.js', () => ({
    feedsOf: async () => ['https://feed.example/rss'],
    // as the real one, more simply: the news of each term
    newsOfTerms: (terms, articles) => terms.map(term => {
        const news = articles.filter(article => article.title.includes(term))
            .map(article => ({storyId: article.id_story, title: article.title, url: article.link, publishedAt: article.published_at}));
        return {term, count: news.length, news};
    }),
}));
const readItem = jest.fn();
const searchItems = jest.fn();
jest.unstable_mockModule('../../services/utils/wikidata.js', async () => ({
    ...await import('../../services/utils/wikidata-names.js'),
    readItem, searchItems, isQid: (value) => /^Q\d+$/.test(value ?? ''),
}));

const {EntityService, mergeNews, namesFor} = await import('../../services/entity-service.js');
const {kindOf, namesOf, usableName, withoutClubWords} = await import('../../services/utils/wikidata-names.js');

const PSG = {id: 1, qid: 'Q483020', label: 'Paris Saint-Germain FC', description: 'club', kind: 'club',
    names: ['Paris Saint-Germain FC', 'Paris Saint-Germain', 'PSG'], fetched_at: new Date()};
const article = (id, title, story = id, at = `2026-10-08T1${id}:00:00.000Z`) => ({id, id_story: story, title, link: `https://m.example/${id}`, published_at: at});

beforeEach(() => {
    Object.values(EntityModel).forEach(mock => mock.mockClear());
    EntityModel.byQid.mockResolvedValue(PSG);
    EntityModel.links.mockResolvedValue([
        {id: 2, qid: 'Q1', label: 'Ousmane Dembélé', kind: 'person', names: ['Ousmane Dembélé'], relation: 'player'},
        {id: 3, qid: 'Q2', label: 'Luis Enrique', kind: 'person', names: ['Luis Enrique'], relation: 'coach'},
        {id: 4, qid: 'Q3', label: 'Parc des Princes', kind: 'other', names: [], relation: 'venue'},
        {id: 3, qid: 'Q2', label: 'Luis Enrique', kind: 'person', names: ['Luis Enrique'], relation: 'chair'},
    ]);
    articlesHolding.mockReset().mockResolvedValue([
        article(5, 'PSG : Luis Enrique ménage Ousmane Dembélé', 50),
        article(4, 'Le PSG au Parc des Princes', 40),
        article(3, 'Paris Saint-Germain gagne', 40),
        article(2, 'Ousmane Dembélé blessé', 20),
    ]);
    readItem.mockReset();
});

describe('the names of an item of Wikidata', () => {
    it('should keep a name of several words, an acronym or a name with a figure, never a single common word', () => {
        expect(['Paris', 'football', 'PSG', 'UEFA', 'Schalke 04', 'U.E.F.A.', 'Paris SG', 'P'].map(usableName))
            .toEqual([false, false, true, true, true, true, true, false]);
    });

    it('should name a club without its FC too, once each whatever the case, in latin letters only', () => {
        expect(withoutClubWords('PSG F.C.')).toBe('PSG');
        expect(namesOf(['Paris Saint-Germain FC'], ['Paris', 'PSG F.C.', 'paris saint-germain fc', 'ΟΥΕΦΑ'], [], {club: true}))
            .toEqual(['Paris Saint-Germain FC', 'PSG F.C.', 'Paris Saint-Germain', 'PSG']);
    });

    it('should tell a person, a club, a competition by what they are an instance of', () => {
        expect([['Q5'], ['Q476028'], ['Q15991303'], ['Q43229'], ['Q999']].map(kindOf))
            .toEqual(['person', 'club', 'competition', 'organisation', 'other']);
    });

    it('should take out the names the reader took out, and add theirs', () => {
        expect(namesFor(PSG, {added_names: ['Les Parisiens', 'psg'], removed_names: ['paris saint-germain fc']}))
            .toEqual(['Paris Saint-Germain', 'PSG', 'Les Parisiens']);
    });
});

describe('mergeNews', () => {
    it('should list the news of several names once, one per story, the newest first, with the names each one carries', () => {
        const merged = mergeNews([
            {term: 'PSG', news: [{url: 'a', storyId: 1, publishedAt: '2026-10-08T10:00'}, {url: 'b', storyId: 2, publishedAt: '2026-10-08T12:00'}]},
            {term: 'Paris Saint-Germain', news: [{url: 'a', storyId: 1, publishedAt: '2026-10-08T10:00'}, {url: 'c', storyId: 2, publishedAt: '2026-10-08T11:00'}]},
        ]);
        expect(merged.count).toBe(2);
        expect(merged.news.map(news => [news.url, news.names])).toEqual([['b', ['PSG']], ['a', ['PSG', 'Paris Saint-Germain']]]);
    });
});

describe('EntityService.page', () => {
    it('should give the news naming it, then each link with its own, the most named first, a link of two relations once', async () => {
        const page = await EntityService.page(8, 'Q483020', 48);

        expect(readItem).not.toHaveBeenCalled();
        expect(page.count).toBe(2);         // two stories: 50, and 40 told twice
        expect(page.news.map(news => news.storyId)).toEqual([50, 40]);
        expect(page.links.map(link => [link.label, link.relation, link.count])).toEqual([
            ['Ousmane Dembélé', 'player', 2], ['Luis Enrique', 'coach, chair', 1], ['Parc des Princes', 'venue', 1],
        ]);
        // each name with and without its accents, in one search
        expect(articlesHolding.mock.calls[0][0].texts).toEqual(expect.arrayContaining(['Ousmane Dembélé', 'Ousmane Dembele', 'PSG', 'Parc des Princes']));
    });

    it('should keep the news a few minutes, and read again from Wikidata an item only met as a link', async () => {
        await EntityService.page(8, 'Q483020', 48);
        await EntityService.page(8, 'Q483020', 48);
        expect(articlesHolding).toHaveBeenCalledTimes(0);

        EntityModel.byQid.mockResolvedValueOnce({...PSG, fetched_at: null}).mockResolvedValueOnce(PSG);
        readItem.mockResolvedValue({qid: 'Q483020', label: 'Paris Saint-Germain FC', kind: 'club', names: PSG.names, links: []});
        await EntityService.page(8, 'Q483020', 24);
        expect(readItem).toHaveBeenCalledWith('Q483020', 'fr');
        expect(EntityModel.save).toHaveBeenCalled();
    });

    it('should refuse an id that is not one of Wikidata, and a window it does not offer', async () => {
        await expect(EntityService.page(8, 'DROP TABLE', 48)).rejects.toMatchObject({status: 400});
        await expect(EntityService.page(8, 'Q483020', 12)).rejects.toMatchObject({status: 400});
    });
});

describe('EntityService.follow and setNames', () => {
    it('should follow 30 at most', async () => {
        EntityModel.count.mockResolvedValueOnce(30);
        await expect(EntityService.follow(8, 'Q483020')).rejects.toMatchObject({status: 400});
        await EntityService.follow(8, 'Q483020');
        expect(EntityModel.follow).toHaveBeenCalledWith(8, 1);
    });

    it('should keep the names of the reader, 10 at most, and take out only names of Wikidata', async () => {
        EntityModel.following.mockResolvedValue({added_names: [], removed_names: []});
        await EntityService.setNames(8, 'Q483020', {added: [' Les "Parisiens" ', 'x'], removed: ['PSG', 'Unknown']});
        expect(EntityModel.setNames).toHaveBeenCalledWith(8, 1, ['Les Parisiens'], ['PSG']);
        await expect(EntityService.setNames(8, 'Q483020', {added: Array.from({length: 11}, (_, i) => `Name ${i}`), removed: []})).rejects.toMatchObject({status: 400});

        EntityModel.following.mockResolvedValue(null);
        await expect(EntityService.setNames(8, 'Q483020', {added: [], removed: []})).rejects.toMatchObject({status: 404});
    });
});
