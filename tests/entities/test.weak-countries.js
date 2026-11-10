//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.weak-countries.js
//  Description: The cards no evidence gives a country to (a friend of the user, 10.11.2026: an article in Vietnamese on the National Games of
//               Vietnam, a federation of Kenya named in full, and no country): the family name alone of a person known by few news, and the
//               country of most of the sites of the card, offered to the AI as weak evidence, for a card with no other candidate only
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const namesOfArticles = jest.fn();
const countriesOfItems = jest.fn();
const personsEndingWith = jest.fn();
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {namesOfArticles, personsEndingWith,
    personsByLooseSurname: jest.fn(async () => []), inflectedForms: jest.fn(async () => []), want: jest.fn(async () => 0)}}));
const countries = await import('../../services/utils/countries.js');
jest.unstable_mockModule('../../services/utils/countries.js', () => ({...countries, countriesOfItems}));
jest.unstable_mockModule('../../services/utils/name-check.js', () => ({withNamesChecked: jest.fn(async read => read), withNamesLinked: jest.fn(async read => read)}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson}));
jest.unstable_mockModule('../../services/utils/card-spellings.js', () => ({labelsOfItems: jest.fn(async () => new Map())}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({nameKeysOf: jest.fn(async () => new Map())}));
const {countryOfSites, weakCandidates, weakPrompt, chooseWeakCountries, normalizeChoice} = await import('../../services/utils/country-choice.js');
const {namesAndCountriesOfCards} = await import('../../services/utils/card-names.js');

const KENYAN = {country: 'KE', international: false, bodies: [], media: false};
const UEFA = {country: null, international: true, bodies: [], media: false};
const row = (name, kind, qid, inCard = 2) => ({id: Math.floor(Math.random() * 1e6), name, kind, qid, inCard, itemInCard: qid ? inCard : null, news: 3});
const card = (extra = {}) => ({storyId: 1, ids: [1, 2], media: [], titles: ['Mariga rejects dismissal of FKF NEC members'], text: 'Macdonald Mariga said...', ...extra});

beforeEach(() => {
    for (const mock of [namesOfArticles, countriesOfItems, personsEndingWith, ollamaJson]) mock.mockReset();
    personsEndingWith.mockResolvedValue([]);
    countriesOfItems.mockResolvedValue(new Map());
});

describe('countryOfSites', () => {
    it('should give the country most of the sites are of, by their domain', () => {
        expect(countryOfSites(['vnexpress.vn'])).toBe('VN');
        expect(countryOfSites(['bbc.co.uk', 'skysports.com'])).toBe('GB');
        expect(countryOfSites(['prosport.ro', 'gsp.ro', 'lequipe.fr'])).toBe('RO');
    });

    it('should give none when the sites are of no country in particular: a card of the world is told by many', () => {
        expect(countryOfSites(['a.de', 'b.fr', 'c.be', 'd.ch', 'e.com'])).toBeNull();
        expect(countryOfSites(['a.com', 'b.net'])).toBeNull();
        expect(countryOfSites(['a.tv', 'b.io', 'c.fm'])).toBeNull();
        expect(countryOfSites([])).toBeNull();
        expect(countryOfSites(undefined)).toBeNull();
    });

    it('should count a site once, whatever the news it has', () => {
        expect(countryOfSites(['a.ro', 'a.ro', 'a.ro', 'b.com', 'c.com'])).toBeNull();
        expect(countryOfSites(['a.ro', 'a.ro', 'b.com'])).toBe('RO');
    });
});

describe('weakCandidates', () => {
    const mariga = [{qid: 'Q1', weight: 3, person: true, name: 'Mariga'}];

    it('should give the country of the person a family name alone is linked to, then the country of the sites', () => {
        expect(weakCandidates(mariga, new Map([['Q1', KENYAN]]), ['standardmedia.co.ke'])).toEqual([{code: 'KE', kind: 'surname', name: 'Mariga'}]);
        expect(weakCandidates(mariga, new Map([['Q1', KENYAN]]), ['lequipe.fr'])).toEqual([{code: 'KE', kind: 'surname', name: 'Mariga'}, {code: 'FR', kind: 'sites', sites: 1}]);
        expect(weakCandidates([], new Map(), ['vnexpress.vn'])).toEqual([{code: 'VN', kind: 'sites', sites: 1}]);
    });

    it('should give none for a person with no country, nor for sites of no country', () => {
        expect(weakCandidates(mariga, new Map([['Q1', {country: null, international: false, bodies: [], media: false}]]), ['a.com'])).toEqual([]);
        expect(weakCandidates([], new Map(), [])).toEqual([]);
    });
});

describe('weakPrompt', () => {
    const cards = [
        {titles: ['Mariga rejects dismissal'], text: 'Macdonald Mariga   said', candidates: [{code: 'KE', kind: 'surname', name: 'Mariga'}]},
        {titles: ['26 international referees manage National Games 2026'], text: '', candidates: [{code: 'VN', kind: 'sites', sites: 1}]},
    ];

    it('should say what each candidate is from, and that a doubt keeps none', () => {
        const prompt = weakPrompt(cards);
        expect(prompt).toContain('[1] Mariga rejects dismissal\nMacdonald Mariga said\nCandidats : KE Kenya: « Mariga » (nom de famille seul');
        expect(prompt).toContain('[2] 26 international referees manage National Games 2026');
        expect(prompt).toContain('VN Viêt Nam: les sites qui racontent l\'actualité sont de ce pays');
        expect(prompt).toContain('le pays des sites qui racontent l\'actualité ne suffit pas');
        expect(prompt).toContain('Dans le doute, ne garde pas');
    });
});

describe('chooseWeakCountries', () => {
    it('should keep the candidates the AI says only, and nothing for no card', async () => {
        const cards = [{titles: ['t'], text: '', candidates: [{code: 'KE', kind: 'surname', name: 'Mariga'}]}];
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: ['KE', 'FR']}]});
        expect([...await chooseWeakCountries(cards)]).toEqual([[0, ['KE']]]);
        expect((await chooseWeakCountries([])).size).toBe(0);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect(normalizeChoice({cards: []}, cards).size).toBe(0);
    });
});

// the whole of a briefing: names of the articles, the countries of the items, the AI asked twice at most (the candidates of Wikidata, then the weak ones)
describe('namesAndCountriesOfCards, the weak evidence', () => {
    const asked = (prompt) => ollamaJson.mock.calls.filter(([text]) => text.includes(prompt)).length;
    // "Mariga" alone, linked to the person named in full by 40 news only (SURNAME_COUNTRY_SEEN is 100)
    const marigaAlone = (seen = 40) => {
        namesOfArticles.mockResolvedValue([row('Mariga', 'person', null), row('FKF', 'organization', null)]);
        personsEndingWith.mockResolvedValue([{word: 'mariga', qid: 'Q313893', seen, asPerson: seen, asOther: 0}]);
        countriesOfItems.mockResolvedValue(new Map([['Q313893', KENYAN]]));
    };

    it('should give the country of a family name alone when the AI keeps it, the rules not giving it (Mariga, Kenya)', async () => {
        marigaAlone();
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: ['KE']}]});
        const [found] = (await namesAndCountriesOfCards([card()])).values();
        expect(found.countries).toEqual(['KE']);
        expect(found.rules).toEqual([]);
        expect(found.weak).toEqual([{code: 'KE', kind: 'surname', name: 'Mariga'}]);
        // only the weak question: the card had no candidate of Wikidata
        expect(asked('aucun pays n\'a été trouvé de façon sûre')).toBe(1);
        expect(asked('les pays candidats trouvés grâce aux personnes')).toBe(0);
    });

    it('should leave the card with none when the AI keeps none, or does not answer: a wrong country is worse', async () => {
        marigaAlone();
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: []}]});
        expect([...(await namesAndCountriesOfCards([card()])).values()][0].countries).toEqual([]);
        ollamaJson.mockRejectedValue(new Error('down'));
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect([...(await namesAndCountriesOfCards([card()])).values()][0].countries).toEqual([]);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('weak countries of the cards were not chosen'));
        error.mockRestore();
    });

    it('should not ask the weak question without the AI (choose: false), and not use a family name known by 100 news as weak', async () => {
        marigaAlone();
        const [off] = (await namesAndCountriesOfCards([card()], {choose: false})).values();
        expect(off.countries).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
        // 100 news in full: the rules give the country, as before
        marigaAlone(100);
        ollamaJson.mockResolvedValue({cards: []});
        const [strong] = (await namesAndCountriesOfCards([card()], {choose: false})).values();
        expect(strong.countries).toEqual(['KE']);
        expect(strong.weak).toEqual([]);
    });

    it('should offer the country of the sites of a card with no name at all (the National Games of Vietnam)', async () => {
        namesOfArticles.mockResolvedValue([]);
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: ['VN']}]});
        const [found] = (await namesAndCountriesOfCards([card({titles: ['26 international referees manage National Games 2026'], sites: ['vnexpress.vn']})])).values();
        expect(found.countries).toEqual(['VN']);
        expect(found.weak).toEqual([{code: 'VN', kind: 'sites', sites: 1}]);
    });

    it('should not offer the country of the sites when the card is told by the press of many countries', async () => {
        namesOfArticles.mockResolvedValue([]);
        const [found] = (await namesAndCountriesOfCards([card({sites: ['a.de', 'b.fr', 'c.vn', 'd.com']})])).values();
        expect(found.weak).toEqual([]);
        expect(found.countries).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should not ask the weak question for a card that has a country, nor for one whose candidates the AI refused', async () => {
        // the card names UEFA only and a Kenyan person in full: the rules give Kenya, the sites of Vietnam count for nothing
        namesOfArticles.mockResolvedValue([row('UEFA', 'organization', 'Q35572'), row('Macdonald Mariga', 'person', 'Q313893')]);
        countriesOfItems.mockResolvedValue(new Map([['Q35572', UEFA], ['Q313893', KENYAN]]));
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: []}]});
        const [refused] = (await namesAndCountriesOfCards([card({sites: ['vnexpress.vn']})])).values();
        // the AI kept none of the candidates: that is its answer, no weak evidence changes it
        expect(refused.countries).toEqual([]);
        expect(asked('aucun pays n\'a été trouvé de façon sûre')).toBe(0);
    });
});
