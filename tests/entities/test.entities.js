//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.entities.js
//  Description: What a profile follows: the clubs, people and organisations of Wikidata, the names their
//               news are found by, the page of one, its news and the ones of what it is linked to; the
//               names and words as written, the page of a name, the names to follow, and their news in
//               the briefing
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const EntityModel = {
    byQid: jest.fn(), save: jest.fn(async () => 1), links: jest.fn(async () => []), following: jest.fn(async () => null),
    followed: jest.fn(async () => []), count: jest.fn(async () => 0), follow: jest.fn(), unfollow: jest.fn(async () => 1), setNames: jest.fn(),
    setInBriefing: jest.fn(async () => 1),
};
const articlesHolding = jest.fn(async () => []);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/entity-model.js', () => ({EntityModel}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {articlesHolding}}));
const ProfileModel = {get: jest.fn(), setWatchTerms: jest.fn()};
const BriefingModel = {recentCards: jest.fn(async () => [])};
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel}));
// the news the tagger read, and how many it has not (some: their texts are searched)
const MentionModel = {articlesNamed: jest.fn(async () => []), personsEndingWith: jest.fn(async () => []), anyUntagged: jest.fn(async () => true), qidsOfKey: jest.fn(async () => []),
    articlesOfStories: jest.fn(async () => []), namesOfArticles: jest.fn(async () => []), want: jest.fn(async () => 0)};
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel}));
const inTitle = (term) => (article) => article.title.includes(term);
jest.unstable_mockModule('../../services/briefing-service.js', () => ({
    feedsOf: async () => ['https://feed.example/rss'],
    namingTerm: inTitle,
    // as the real one, more simply: the news of each term, 'limit' kept, all counted
    newsOfTerms: (terms, articles, {limit = 100, holds = inTitle} = {}) => terms.map(term => {
        const news = articles.filter(holds(term))
            .map(article => ({storyId: article.id_story, title: article.title, url: article.link, publishedAt: article.published_at}));
        return {term, count: news.length, news: news.slice(0, limit)};
    }),
}));
const readItem = jest.fn();
const searchItems = jest.fn();
jest.unstable_mockModule('../../services/utils/wikidata.js', async () => ({
    ...await import('../../services/utils/wikidata-names.js'),
    readItem, searchItems, readCountries: async () => new Map(), isQid: (value) => /^Q\d+$/.test(value ?? ''),
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
    ProfileModel.get.mockReset().mockResolvedValue({text: 'Le football', languages: ['fr'], watch_terms: []});
    ProfileModel.setWatchTerms.mockClear();
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
        const page = await EntityService.page(8, 'Q483020', 72);

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
        await EntityService.page(8, 'Q483020', 72);
        await EntityService.page(8, 'Q483020', 72);
        expect(articlesHolding).toHaveBeenCalledTimes(0);

        EntityModel.byQid.mockResolvedValueOnce({...PSG, fetched_at: null}).mockResolvedValueOnce(PSG);
        readItem.mockResolvedValue({qid: 'Q483020', label: 'Paris Saint-Germain FC', kind: 'club', names: PSG.names, links: []});
        await EntityService.page(8, 'Q483020', 24);
        expect(readItem).toHaveBeenCalledWith('Q483020', 'fr');
        expect(EntityModel.save).toHaveBeenCalled();
    });

    it('should find the news by the names the tagger found in them, and by the names it linked to the item, without searching texts once all are tagged', async () => {
        MentionModel.anyUntagged.mockResolvedValueOnce(false);
        MentionModel.articlesNamed.mockResolvedValueOnce([
            {...article(7, 'Le club gagne', 70), keys: ['psg'], qids: []},
            {...article(8, 'Les Parisiens en Ligue des champions', 80), keys: ['parisiens'], qids: ['Q483020']},
            {...article(9, 'Doublé du Ballon d’or', 90), keys: ['ousmane dembele'], qids: []},
        ]);
        const page = await EntityService.page(11, 'Q483020', 72);

        expect(articlesHolding).not.toHaveBeenCalled();
        expect(page.news.map(news => news.storyId)).toEqual([80, 70]);     // the newest first
        expect(page.links.find(link => link.label === 'Ousmane Dembélé').count).toBe(1);
        const asked = MentionModel.articlesNamed.mock.calls.at(-1)[0];
        expect(asked.keys).toEqual(expect.arrayContaining(['psg', 'paris saint-germain', 'ousmane dembele', 'parc des princes']));
        expect(asked.qids).toEqual(expect.arrayContaining(['Q483020', 'Q1', 'Q2', 'Q3']));
    });

    it('should search the texts of the news the tagger has not read only', async () => {
        articlesHolding.mockResolvedValueOnce([{...article(5, 'PSG gagne', 50), entities_at: new Date()}, article(6, 'PSG perd', 60)]);
        const page = await EntityService.page(13, 'Q483020', 72);
        expect(page.news.map(news => news.storyId)).toEqual([60]);
    });

    it('should count every story naming it, not only the news kept per name', async () => {
        MentionModel.articlesNamed.mockResolvedValueOnce(Array.from({length: 130}, (_, i) => ({...article(i + 10, `Match ${i}`, i + 100), keys: ['psg'], qids: []})));
        articlesHolding.mockResolvedValueOnce([]);
        const page = await EntityService.page(12, 'Q483020', 72);
        expect(page.count).toBe(130);
    });

    it('should refuse an id that is not one of Wikidata, and a window it does not offer', async () => {
        await expect(EntityService.page(8, 'DROP TABLE', 72)).rejects.toMatchObject({status: 400});
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

describe('the names and words followed as written', () => {
    it('should follow a word once whatever its case, 20 at most, and take one out', async () => {
        ProfileModel.get.mockResolvedValue({watch_terms: ['VAR']});
        expect(await EntityService.addWord(8, ' "Roberto Rosetti" ')).toEqual({words: ['VAR', 'Roberto Rosetti']});
        expect(ProfileModel.setWatchTerms).toHaveBeenCalledWith(8, ['VAR', 'Roberto Rosetti']);
        ProfileModel.setWatchTerms.mockClear();
        expect(await EntityService.addWord(8, 'var')).toEqual({words: ['VAR']});
        expect(ProfileModel.setWatchTerms).not.toHaveBeenCalled();

        ProfileModel.get.mockResolvedValue({watch_terms: Array.from({length: 20}, (_, i) => `terme ${i}`)});
        await expect(EntityService.addWord(8, 'PSG')).rejects.toMatchObject({status: 400});

        ProfileModel.get.mockResolvedValue({watch_terms: ['VAR', 'PSG']});
        expect(await EntityService.removeWord(8, 'psg')).toEqual({words: ['VAR']});
        await expect(EntityService.removeWord(8, 'UEFA')).rejects.toMatchObject({status: 404});
    });

    it('should list the items and the words together, with their limits', async () => {
        EntityModel.followed.mockResolvedValueOnce([{...PSG, added_names: [], removed_names: [], in_briefing: false, links: 3}]);
        ProfileModel.get.mockResolvedValue({watch_terms: ['VAR']});
        const all = await EntityService.all(8);
        expect(all.entities).toEqual([expect.objectContaining({qid: 'Q483020', followed: true, inBriefing: false, links: 3})]);
        expect(all.words).toEqual(['VAR']);
        expect(all.limits).toEqual({entities: 30, words: 20});
    });
});

describe('EntityService.setInBriefing', () => {
    it('should put the news of an item followed in the briefing or take them out, of an item followed only', async () => {
        EntityModel.following.mockResolvedValue({added_names: [], removed_names: [], in_briefing: false});
        expect((await EntityService.setInBriefing(8, 'Q483020', false)).inBriefing).toBe(false);
        expect(EntityModel.setInBriefing).toHaveBeenCalledWith(8, 1, false);
        await expect(EntityService.setInBriefing(8, 'Q483020', 'yes')).rejects.toMatchObject({status: 400});
        EntityModel.setInBriefing.mockResolvedValueOnce(0);
        await expect(EntityService.setInBriefing(8, 'Q483020', true)).rejects.toMatchObject({status: 404});
        EntityModel.following.mockResolvedValue(null);
    });
});

describe('the news of what the profile follows in its briefing', () => {
    it('should give each item in the briefing its news by its names and its item, and mark items by their names and words by themselves', async () => {
        EntityModel.followed.mockResolvedValue([{...PSG, added_names: [], removed_names: ['Paris Saint-Germain FC'], in_briefing: true}]);
        MentionModel.anyUntagged.mockResolvedValue(false);
        MentionModel.articlesNamed.mockResolvedValueOnce([
            {...article(6, 'Le PSG gagne', 60), keys: ['psg'], qids: ['Q483020']},
            {...article(7, 'Parigi festeggia', 70), keys: ['parigi'], qids: ['Q483020']},
        ]);
        const [group] = await EntityService.briefingGroups(9, 48);
        // shown by its acronym, as in the tabs of the briefing
        expect(group).toMatchObject({term: 'PSG', qid: 'Q483020', count: 2});
        expect(EntityModel.followed).toHaveBeenCalledWith(9, {inBriefing: true});

        expect(await EntityService.followTerms(9, ['VAR'])).toEqual([
            {label: 'PSG', qid: 'Q483020', names: ['Paris Saint-Germain', 'PSG']},
            {label: 'VAR', qid: null, names: ['VAR']},
        ]);
        MentionModel.anyUntagged.mockResolvedValue(true);
        EntityModel.followed.mockResolvedValue([]);
    });
});

describe('EntityService.namePage', () => {
    it('should give the news of a name as written, the item the tagger linked it to, and whether it is followed', async () => {
        MentionModel.qidsOfKey.mockResolvedValueOnce(['Q99']);
        ProfileModel.get.mockResolvedValue({watch_terms: ['lff']});
        articlesHolding.mockResolvedValueOnce([article(8, 'La LFF soutient Infantino', 80)]);
        const page = await EntityService.namePage(10, 'LFF', 72);
        expect(page).toMatchObject({name: 'LFF', qid: 'Q99', followed: true, wordsLeft: 19, count: 1});
        expect(MentionModel.qidsOfKey).toHaveBeenCalledWith('lff');
        expect(MentionModel.want).toHaveBeenCalledWith({key: 'lff'});

        MentionModel.qidsOfKey.mockResolvedValueOnce(['Q1', 'Q2']);
        expect((await EntityService.namePage(10, 'Paris', 24)).qid).toBeNull();
        await expect(EntityService.namePage(10, 'P', 72)).rejects.toMatchObject({status: 400});
        await expect(EntityService.namePage(10, 'LFF', 12)).rejects.toMatchObject({status: 400});
    });
});

describe('EntityService.suggestions', () => {
    it('should suggest the names of several cards not followed, the cards without names read from their story', async () => {
        BriefingModel.recentCards.mockResolvedValueOnce([
            {storyId: 1, names: [{name: 'UEFA', qid: 'Q35572', kind: 'organization'}, {name: 'LFF', qid: null, kind: 'organization'}]},
            {storyId: 2, names: [{name: 'UEFA', qid: 'Q35572', kind: 'organization'}, {name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'}]},
            {storyId: 2, names: [{name: 'UEFA', qid: 'Q35572', kind: 'organization'}]},
            {storyId: 3, names: null},
        ]);
        MentionModel.articlesOfStories.mockResolvedValueOnce([{id_story: 3, ids: [30, 31]}]);
        MentionModel.namesOfArticles.mockResolvedValueOnce([
            {id: 11, name: 'LFF', qid: null, kind: 'organization', inCard: 2, news: 3},
            {id: 12, name: 'Infantino', qid: null, kind: 'person', inCard: 2, news: 3},
            {id: 13, name: 'Gianni Infantino', qid: 'Q124138', kind: 'person', inCard: 1, news: 3},
        ]);
        EntityModel.followed.mockResolvedValueOnce([{qid: 'Q35572'}]);
        ProfileModel.get.mockResolvedValue({watch_terms: []});
        const names = await EntityService.suggestions(8);
        expect(MentionModel.articlesOfStories).toHaveBeenCalledWith([3]);
        // the name shown without an item is looked for in Wikidata first, the one of an item is not
        expect(MentionModel.want).toHaveBeenCalledWith({ids: [11]});
        // UEFA is followed, a card is counted once, "Infantino" is Gianni Infantino
        expect(names).toEqual([
            {name: 'Gianni Infantino', qid: 'Q124138', kind: 'person', cards: 2},
            {name: 'LFF', qid: null, kind: 'organization', cards: 2},
        ]);
    });
});
