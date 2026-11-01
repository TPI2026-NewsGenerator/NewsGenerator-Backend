//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.entities.js
//  Description: What a profile follows: the clubs, people and organisations of Wikidata, the names their
//               news are found by, the page of one, its news and the ones of what it is linked to; the
//               names and words as written, the page of a name, the names to follow, and their news in
//               the briefing
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const EntityModel = {
    byQid: jest.fn(), save: jest.fn(async () => 1), links: jest.fn(async () => []), following: jest.fn(async () => null),
    followed: jest.fn(async () => []), count: jest.fn(async () => 0), follow: jest.fn(), unfollow: jest.fn(async () => 1), setNames: jest.fn(),
    setInBriefing: jest.fn(async () => 1), byQids: jest.fn(async () => []), addNamed: jest.fn(async () => 0), followMany: jest.fn(async () => 0),
};
const articlesHolding = jest.fn(async () => []);
const untaggedArticles = jest.fn(async () => []);
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/entity-model.js', () => ({EntityModel}));
jest.unstable_mockModule('../../models/feed-model.js', () => ({FeedModel: {articlesHolding, untaggedArticles}}));
const ProfileModel = {get: jest.fn(), setWatchTerms: jest.fn()};
const BriefingModel = {recentCards: jest.fn(async () => [])};
jest.unstable_mockModule('../../models/briefing-model.js', () => ({BriefingModel}));
jest.unstable_mockModule('../../models/profile-model.js', () => ({ProfileModel}));
// the news the tagger read, and how many it has not (some: their texts are searched)
const seenOf = jest.fn(async () => new Map());
const MentionModel = {seenOf, articlesNamed: jest.fn(async () => []), personsEndingWith: jest.fn(async () => []), anyUntagged: jest.fn(async () => true), qidsOfKey: jest.fn(async () => []),
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
const candidatesFor = jest.fn(async () => ({exact: [], others: []}));
const describeItems = jest.fn(async () => []);
jest.unstable_mockModule('../../services/utils/wikidata.js', async () => ({
    ...await import('../../services/utils/wikidata-names.js'),
    readItem, searchItems, candidatesFor, describeItems, PERSON_SITELINKS: 10, SITELINKS_AHEAD: 3, readCountries: async () => new Map(), exactItems: async () => [], wikimediaHeaders: () => ({}), isQid: (value) => /^Q\d+$/.test(value ?? ''),
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
        articlesHolding.mockResolvedValueOnce([article(6, 'PSG perd', 60)]);
        const page = await EntityService.page(13, 'Q483020', 72);
        expect(page.news.map(news => news.storyId)).toEqual([60]);
        // asked of the database, where an index holds them: the ones read are millions in a month
        expect(articlesHolding).toHaveBeenCalledWith(expect.objectContaining({untagged: true}));
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
    it('should follow 300 names at most, the items and the words together', async () => {
        EntityModel.count.mockResolvedValueOnce(250);
        ProfileModel.get.mockResolvedValueOnce({text: 'Le football', languages: ['fr'], watch_terms: Array.from({length: 50}, (_, i) => `terme ${i}`)});
        await expect(EntityService.follow(8, 'Q483020')).rejects.toMatchObject({status: 400, message: expect.stringContaining('300')});
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
    it('should follow a word once whatever its case, 300 names at most with the items, and take one out', async () => {
        ProfileModel.get.mockResolvedValue({watch_terms: ['VAR']});
        expect(await EntityService.addWord(8, ' "Roberto Rosetti" ')).toEqual({words: ['VAR', 'Roberto Rosetti']});
        expect(ProfileModel.setWatchTerms).toHaveBeenCalledWith(8, ['VAR', 'Roberto Rosetti']);
        ProfileModel.setWatchTerms.mockClear();
        expect(await EntityService.addWord(8, 'var')).toEqual({words: ['VAR']});
        expect(ProfileModel.setWatchTerms).not.toHaveBeenCalled();

        ProfileModel.get.mockResolvedValue({watch_terms: Array.from({length: 299}, (_, i) => `terme ${i}`)});
        EntityModel.count.mockResolvedValueOnce(1);
        await expect(EntityService.addWord(8, 'PSG')).rejects.toMatchObject({status: 400});
        // the last place is free when the items leave it
        EntityModel.count.mockResolvedValueOnce(0);
        expect((await EntityService.addWord(8, 'PSG')).words).toHaveLength(300);

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
        expect(all.limits).toEqual({total: 300});
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

    it('should read the window it is given, keep the news wanted and count them all, and read only the items asked for', async () => {
        const rows = [
            {...PSG, added_names: [], removed_names: [], in_briefing: true},
            {...PSG, id: 5, qid: 'Q35572', label: 'UEFA', names: ['UEFA'], added_names: [], removed_names: [], in_briefing: true},
        ];
        EntityModel.followed.mockResolvedValue(rows);
        MentionModel.anyUntagged.mockResolvedValue(false);
        MentionModel.articlesNamed.mockResolvedValue(Array.from({length: 30}, (_, i) => ({...article(i + 10, `Le PSG gagne ${i}`, 100 + i, `2026-10-08T10:${String(i).padStart(2, '0')}:00.000Z`), keys: ['psg'], qids: ['Q483020']})));

        const [group] = await EntityService.briefingGroups(14, 30 * 24, {limit: 20, only: ['Q483020']});
        expect(group).toMatchObject({qid: 'Q483020', count: 30});
        expect(group.news).toHaveLength(20);
        // the other item was not asked for
        expect(await EntityService.briefingGroups(14, 30 * 24, {limit: 20, only: ['Q483020']})).toHaveLength(1);
        const {since} = MentionModel.articlesNamed.mock.calls.at(-1)[0];
        expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600e3);

        MentionModel.articlesNamed.mockReset().mockResolvedValue([]);
        MentionModel.anyUntagged.mockResolvedValue(true);
        EntityModel.followed.mockResolvedValue([]);
    });
});

describe('many names followed', () => {
    const item = (n, label = `Person ${n}`) => ({id: 100 + n, qid: `Q${1000 + n}`, label, description: null, kind: 'person', names: [label], added_names: [], removed_names: [], in_briefing: true, links: 0});
    // whatever a test set is put back, even when it failed
    afterEach(() => {
        MentionModel.articlesNamed.mockReset().mockResolvedValue([]);
        MentionModel.anyUntagged.mockResolvedValue(true);
        EntityModel.followed.mockResolvedValue([]);
        seenOf.mockReset().mockResolvedValue(new Map());
        articlesHolding.mockReset().mockResolvedValue([]);
        untaggedArticles.mockReset().mockResolvedValue([]);
    });

    it('should search all the items of the briefing at once, not one search each', async () => {
        EntityModel.followed.mockResolvedValue([item(1), item(2), item(3)]);
        MentionModel.anyUntagged.mockResolvedValue(false);
        MentionModel.articlesNamed.mockResolvedValueOnce([
            {...article(6, 'Person 1 wins', 61), keys: ['person 1'], qids: []},
            {...article(7, 'Person 3 loses', 71), keys: ['person 3'], qids: ['Q1003']},
        ]);
        const groups = await EntityService.briefingGroups(21, 24, {limit: 10});

        expect(MentionModel.articlesNamed).toHaveBeenCalledTimes(1);
        const asked = MentionModel.articlesNamed.mock.calls[0][0];
        expect(asked.keys).toEqual(expect.arrayContaining(['person 1', 'person 2', 'person 3']));
        expect(asked.qids).toEqual(['Q1001', 'Q1002', 'Q1003']);
        expect(groups.map(group => [group.term, group.count])).toEqual([['Person 1', 1], ['Person 2', 0], ['Person 3', 1]]);
    });

    it('should read the news the tagger has not read once and look for the names in memory, from many names', async () => {
        const rows = Array.from({length: 40}, (_, i) => item(i + 1));
        EntityModel.followed.mockResolvedValue(rows);
        untaggedArticles.mockResolvedValue([
            article(8, 'Person 7 signs', 81), article(9, 'The weather in Lyon', 91), article(5, 'Person 12 and Person 13', 51),
        ]);
        const groups = await EntityService.briefingGroups(22, 48, {limit: 10});

        expect(untaggedArticles).toHaveBeenCalledTimes(1);
        // 80 texts of an ILIKE each were not asked of the database
        expect(articlesHolding).not.toHaveBeenCalled();
        expect(groups.find(group => group.term === 'Person 7').count).toBe(1);
        expect(groups.find(group => group.term === 'Person 12').count).toBe(1);
        expect(groups.find(group => group.term === 'Person 13').count).toBe(1);
        expect(groups.find(group => group.term === 'Person 8').count).toBe(0);
    });

    it('should search a generic word in the texts and a name by what the tagger found, the ones it never met in the texts too', async () => {
        seenOf.mockResolvedValue(new Map([['roberto rosetti', 12], ['ceferin', 4]]));
        MentionModel.anyUntagged.mockResolvedValue(false);
        MentionModel.articlesNamed.mockResolvedValue([{...article(6, 'Roberto Rosetti retires', 61), keys: ['roberto rosetti'], qids: []}]);
        articlesHolding.mockResolvedValue([article(7, 'La VAR a annulé le but', 71), article(8, 'Mystery Person wins', 81)]);
        const groups = await EntityService.wordsGroups(23, ['VAR', 'Roberto Rosetti', 'Mystery Person', 'Ceferin'], 24, {limit: 10});

        // asked of the tagger: the names, not the acronym ("var" is a place, a body and a person to it)
        const keys = MentionModel.articlesNamed.mock.calls[0][0].keys;
        expect(keys).toEqual(expect.arrayContaining(['roberto rosetti', 'ceferin', 'mystery person']));
        expect(keys).not.toContain('var');
        // asked of the texts: the acronym and the name never met
        const texts = articlesHolding.mock.calls.flatMap(([asked]) => asked.texts);
        expect(texts).toEqual(expect.arrayContaining(['VAR', 'Mystery Person']));
        expect(texts).not.toContain('Roberto Rosetti');
        expect(groups.map(group => [group.term, group.count])).toEqual([['VAR', 1], ['Roberto Rosetti', 1], ['Mystery Person', 1], ['Ceferin', 0]]);
    });

    it('should search the texts for thirty words at most, in lots, the others by the names the tagger found', async () => {
        MentionModel.anyUntagged.mockResolvedValue(false);
        const words = Array.from({length: 40}, (_, i) => `word${i}`);
        await EntityService.wordsGroups(24, words, 24);

        expect(articlesHolding).toHaveBeenCalledTimes(3);
        const texts = new Set(articlesHolding.mock.calls.flatMap(([asked]) => asked.texts));
        expect(texts.size).toBe(30);
        expect(texts.has('word29')).toBe(true);
        expect(texts.has('word30')).toBe(false);
        expect(MentionModel.articlesNamed.mock.calls[0][0].keys).toEqual(expect.arrayContaining(['word30', 'word39']));
        expect(MentionModel.articlesNamed.mock.calls[0][0].keys).not.toContain('word0');
    });

    it('should search nothing for no word', async () => {
        expect(await EntityService.wordsGroups(25, [], 24)).toEqual([]);
        expect(MentionModel.articlesNamed).not.toHaveBeenCalled();
        expect(articlesHolding).not.toHaveBeenCalled();
    });
});

describe('a list of names followed at once', () => {
    const found = (qid, label, description = null) => ({qid, label, description});
    const kept = (word) => ({watch_terms: word, text: 'Le football', languages: ['fr']});
    afterEach(() => {
        EntityModel.followed.mockResolvedValue([]);
        EntityModel.count.mockResolvedValue(0);
        EntityModel.byQids.mockReset().mockResolvedValue([]);
        candidatesFor.mockReset().mockResolvedValue({exact: [], others: []});
        describeItems.mockReset().mockResolvedValue([]);
        readItem.mockReset();
    });

    it('should tell each name: known, linked to its only item, linked to the one that stands out, to choose, as written, or invalid', async () => {
        EntityModel.followed.mockResolvedValue([{...PSG, added_names: [], removed_names: [], in_briefing: true}]);
        ProfileModel.get.mockResolvedValue(kept(['VAR']));
        candidatesFor.mockImplementation(async (name) => ({
            'Gianni Infantino': {exact: [found('Q124138', 'Gianni Infantino')], others: []},
            'Real Madrid': {exact: [found('Q2469894', 'Real Madrid', 'Argentine club')], others: [found('Q8682', 'Real Madrid CF', 'Spanish club')]},
            'Michael Oliver': {exact: [found('Q1', 'Michael Oliver', 'referee'), found('Q2', 'Michael Oliver', 'actor')], others: []},
            'Paris': {exact: [found('Q90', 'Paris'), found('Q3', 'Paris')], others: []},
            'Lise Klaveness': {exact: [], others: [found('Q5', 'Lise Klaveness')]},
            // the coach, and a player who has his name as an alias, half as well known: the coach is called so
            'Pep Guardiola': {exact: [found('Q164038', 'Pep Guardiola', 'coach'), found('Q696463', 'Néstor Gorosito', 'player'), found('Q122854683', 'Ariel Galeano', 'manager')],
                others: [found('Q121980853', 'Pep Guardiola: první rok v Mnichově', 'book edition'), found('Q124354328', 'Pep Guardiola został wybrany najlepszym trenerem')]},
            // an acronym that is the alias of a league far ahead of the others: not its name, the reader chooses
            'LFF': {exact: [found('Q209008', 'First League'), found('Q7', 'Liburnia Film Festival')], others: []},
        }[name] ?? {exact: [], others: []}));
        // the Wikipedias each item is in: the club of Madrid far ahead of the Argentine one, Paris of the others, the namesakes level
        const inWikipedias = {Q2469894: 2, Q8682: 200, Q90: 300, Q3: 20, Q1: 25, Q2: 22, Q209008: 40, Q7: 5, Q164038: 95, Q696463: 49, Q122854683: 3, Q121980853: 0, Q124354328: 1};
        describeItems.mockImplementation(async (qids) => qids.filter(qid => qid in inWikipedias).map(qid => ({qid, label: qid, description: '', links: inWikipedias[qid]})));

        const {results} = await EntityService.checkNames(8, ['psg', 'var', 'x', 'Gianni Infantino', 'Real Madrid', 'Michael Oliver', 'Paris', 'Lise Klaveness', 'Vadims Ļašenko']);

        expect(results.map(result => [result.name, result.status])).toEqual([
            ['psg', 'known'], ['var', 'known'], ['x', 'invalid'], ['Gianni Infantino', 'linked'], ['Real Madrid', 'linked'],
            ['Michael Oliver', 'choose'], ['Paris', 'linked'], ['Lise Klaveness', 'linked'], ['Vadims Ļašenko', 'word'],
        ]);
        // the item that stands out settles it, whatever the one called exactly so: the club of Madrid, not the Argentine one
        expect(results[4]).toMatchObject({item: {qid: 'Q8682'}, famous: true});
        expect(results[3].famous).toBeUndefined();
        // several of the same weight: the reader chooses, the best known first
        expect(results[5].items.map(item => item.qid)).toEqual(['Q1', 'Q2']);
        // looked for in the language of the profile
        expect(candidatesFor).toHaveBeenCalledWith('Gianni Infantino', 'fr');
        // a name known or invalid is not looked for, nor is one with a single item asked to be told from others
        expect(candidatesFor).toHaveBeenCalledTimes(6);
        // the items of the three doubts counted in one call, not one call each
        expect(describeItems).toHaveBeenCalledTimes(1);
        expect(describeItems.mock.calls[0][0]).toEqual(expect.arrayContaining(['Q2469894', 'Q8682', 'Q1', 'Q2', 'Q90', 'Q3']));

        // the coach far ahead of the books and of a player who has his name as an alias (95 against 49 and 0): linked
        const coach = await EntityService.checkNames(8, ['Pep Guardiola']);
        expect(coach.results[0]).toMatchObject({status: 'linked', famous: true, item: {qid: 'Q164038'}});
        // far ahead in Wikipedias but not called "LFF": left to the reader
        const league = await EntityService.checkNames(8, ['LFF']);
        expect(league.results[0]).toMatchObject({status: 'choose'});
        expect(league.results[0].items.map(item => item.qid)).toEqual(['Q209008', 'Q7']);
    });

    it('should refuse no name, more than ten, a name that is not text, and a profile that is not written', async () => {
        await expect(EntityService.checkNames(8, [])).rejects.toMatchObject({status: 400});
        await expect(EntityService.checkNames(8, Array.from({length: 11}, (_, i) => `Name ${i}`))).rejects.toMatchObject({status: 400});
        await expect(EntityService.checkNames(8, [42])).rejects.toMatchObject({status: 400});
        await expect(EntityService.checkNames(null, ['A name'])).rejects.toMatchObject({status: 400});
    });

    it('should say when Wikidata could not be asked, and settle a doubt it could not decide by the reader', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        candidatesFor.mockRejectedValueOnce(Object.assign(new Error('Wikidata asked to wait.'), {paused: true}));
        await expect(EntityService.checkNames(8, ['Gianni Infantino'])).rejects.toMatchObject({status: 502});

        candidatesFor.mockResolvedValue({exact: [found('Q1', 'Al'), found('Q2', 'Al')], others: []});
        describeItems.mockRejectedValue(new Error('Wikidata lags behind.'));
        const {results} = await EntityService.checkNames(8, ['Al']);
        expect(results[0].status).toBe('choose');
        spy.mockRestore();
    });

    it('should follow the items and the words at once, the items Wikidata has with their label, and read them in full after', async () => {
        EntityModel.followed.mockResolvedValue([{...PSG, added_names: [], removed_names: [], in_briefing: true}]);
        ProfileModel.get.mockResolvedValue(kept(['VAR']));
        // Q10 is known and read, Q11 known by its label only, Q12 new, Q13 not in Wikidata any more
        EntityModel.byQids.mockResolvedValue([{id: 10, qid: 'Q10', fetched_at: new Date()}, {id: 11, qid: 'Q11', fetched_at: null}]);
        describeItems.mockResolvedValue([{qid: 'Q12', label: 'Gianni Infantino', description: 'administrator'}]);
        readItem.mockImplementation(async (qid) => ({qid, label: `Item ${qid}`, description: null, kind: 'person', names: [`Item ${qid}`], links: []}));

        const answer = await EntityService.importNames(8, {qids: ['Q483020', 'Q10', 'Q11', 'Q12', 'Q13', 'Q10'], words: ['VAR', 'Vadims  Ļašenko', 'x', ' "LFF" ', 'lff']});

        // Q483020 is followed already; Q13 is described by nobody
        expect(describeItems).toHaveBeenCalledWith(['Q12', 'Q13'], {batch: 50});
        expect(EntityModel.addNamed).toHaveBeenCalledWith([{qid: 'Q12', label: 'Gianni Infantino', description: 'administrator'}]);
        expect(EntityModel.followMany).toHaveBeenCalledWith(8, ['Q10', 'Q11', 'Q12']);
        expect(ProfileModel.setWatchTerms).toHaveBeenCalledWith(8, ['VAR', 'Vadims Ļašenko', 'LFF']);
        expect(answer.added).toEqual({items: 3, words: 2});
        expect(answer.left).toEqual({full: 0, missing: 1, invalid: 1});
        expect(answer.limits).toEqual({total: 300});

        // the rows only named are read in full one after the other, in background: Q11 and Q12
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(readItem.mock.calls.map(([qid]) => qid)).toEqual(['Q11', 'Q12']);
        expect(EntityModel.save).toHaveBeenCalledTimes(2);
    });

    it('should follow the room left, the items first, and say how many were left out', async () => {
        EntityModel.count.mockResolvedValue(297);
        EntityModel.followed.mockResolvedValue(Array.from({length: 297}, (_, i) => ({...PSG, id: 500 + i, qid: `Q${5000 + i}`, added_names: [], removed_names: [], in_briefing: true})));
        ProfileModel.get.mockResolvedValue(kept([]));
        EntityModel.byQids.mockResolvedValue(['Q1', 'Q2'].map((qid, i) => ({id: i + 1, qid, fetched_at: new Date()})));
        describeItems.mockResolvedValue([{qid: 'Q3', label: 'Third', description: ''}]);

        const answer = await EntityService.importNames(8, {qids: ['Q1', 'Q2', 'Q3'], words: ['Word one', 'Word two']});
        expect(EntityModel.followMany).toHaveBeenCalledWith(8, ['Q1', 'Q2', 'Q3']);
        expect(ProfileModel.setWatchTerms).not.toHaveBeenCalled();
        expect(answer.added).toEqual({items: 3, words: 0});
        expect(answer.left.full).toBe(2);
    });

    it('should refuse a list that is not one, and a profile that follows all it can', async () => {
        await expect(EntityService.importNames(8, {qids: ['DROP TABLE'], words: []})).rejects.toMatchObject({status: 400});
        await expect(EntityService.importNames(8, {qids: [], words: [42]})).rejects.toMatchObject({status: 400});
        await expect(EntityService.importNames(8, {qids: 'Q1', words: []})).rejects.toMatchObject({status: 400});
        await expect(EntityService.importNames(null, {qids: [], words: []})).rejects.toMatchObject({status: 400});

        ProfileModel.get.mockResolvedValue(kept(Array.from({length: 300}, (_, i) => `word ${i}`)));
        EntityModel.followed.mockResolvedValue([]);
        await expect(EntityService.importNames(8, {qids: ['Q1'], words: []})).rejects.toMatchObject({status: 400, message: expect.stringContaining('300')});
    });
});

describe('EntityService.namePage', () => {
    it('should give the news of a name as written, the item the tagger linked it to, and whether it is followed', async () => {
        MentionModel.qidsOfKey.mockResolvedValueOnce(['Q99']);
        ProfileModel.get.mockResolvedValue({watch_terms: ['lff']});
        articlesHolding.mockResolvedValueOnce([article(8, 'La LFF soutient Infantino', 80)]);
        const page = await EntityService.namePage(10, 'LFF', 72);
        expect(page).toMatchObject({name: 'LFF', qid: 'Q99', followed: true, wordsLeft: 299, count: 1});
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
