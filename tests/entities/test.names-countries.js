//
//  Author: Fabian Rostello
//  Date: 08.11.2026
//  File: test.names-countries.js
//  Description: The countries of a card from its names, with the country the words of its names say ("Eesti jalgpalliliit", "Guinean
//               Football Federation") only for a card that nothing else gives a country or a candidate to (the unsaved briefing of Enzo
//               of 8.11.2026: the Estonian card had none)
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const namesOfArticles = jest.fn();
const countriesOfItems = jest.fn();
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {namesOfArticles, personsEndingWith: jest.fn(async () => []),
    personsByLooseSurname: jest.fn(async () => []), inflectedForms: jest.fn(async () => []), want: jest.fn(async () => 0)}}));
const countries = await import('../../services/utils/countries.js');
jest.unstable_mockModule('../../services/utils/countries.js', () => ({...countries, countriesOfItems}));
jest.unstable_mockModule('../../services/utils/name-check.js', () => ({withNamesChecked: jest.fn(async read => read), withNamesLinked: jest.fn(async read => read)}));
const countryChoice = await import('../../services/utils/country-choice.js');
jest.unstable_mockModule('../../services/utils/country-choice.js', () => ({...countryChoice, chooseCountries: jest.fn(async () => new Map())}));
jest.unstable_mockModule('../../services/utils/card-spellings.js', () => ({labelsOfItems: jest.fn(async () => new Map())}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({nameKeysOf: jest.fn(async () => new Map())}));
const {namesAndCountriesOfCards} = await import('../../services/utils/card-names.js');
const {MentionModel} = await import('../../models/mention-model.js');

const card = {storyId: 1, ids: [1, 2], media: [], titles: ['A title']};
const row = (name, kind, qid, inCard = 2) => ({id: Math.floor(Math.random() * 1e6), name, kind, qid, inCard, itemInCard: qid ? inCard : null, news: 3});
const countriesOf = async (rows, info) => {
    namesOfArticles.mockResolvedValue(rows);
    countriesOfItems.mockResolvedValue(new Map(Object.entries(info)));
    return (await namesAndCountriesOfCards([card], {choose: false})).get(1).countries;
};
const UEFA = {country: null, international: true, bodies: [], media: false};

beforeEach(() => {
    namesOfArticles.mockReset();
    countriesOfItems.mockReset();
});

describe('namesAndCountriesOfCards, the country the words of a name say', () => {
    it('should give a card naming an international body and an unlinked federation the country its name starts with (Estonia)', async () => {
        expect(await countriesOf([row('UEFA', 'organization', 'Q35572'), row('Eesti jalgpalliliit', 'organization', null)], {Q35572: UEFA})).toEqual(['EE']);
    });

    it('should give it the country of an adjective of nationality in the name of an organisation (Jordan, in Arabic)', async () => {
        expect(await countriesOf([row('التحكيم الأردني', 'organization', null), row('الحكام الأردنيون', 'organization', null)], {})).toEqual(['JO']);
    });

    it('should leave a card that has a country already to it: the federation of another country named in passing is no vote', async () => {
        const psg = {country: 'FR', international: false, bodies: [], media: false};
        expect(await countriesOf([row('Paris Saint-Germain', 'organization', 'Q1', 3), row('Guinean Football Federation', 'organization', null, 2)], {Q1: psg})).toEqual(['FR']);
    });

    it('should not give a card the country of a person of an international body it names: a card of the UEFA and its president has none', async () => {
        // the president of UEFA is Slovenian, UEFA's body: the rules do not give Slovenia, nor is it offered to the AI (8.11.2026)
        const person = {country: 'SI', international: false, bodies: ['Q35572'], media: false};
        expect(await countriesOf([row('UEFA', 'organization', 'Q35572'), row('Aleksander Čeferin', 'person', 'Q26819142')], {Q35572: UEFA, Q26819142: person})).toEqual([]);
    });

    it('should then give such a card the country of the words of a name it has: the Irish FA meeting the president of the UEFA', async () => {
        // measured on 590 cards: the Irish FA was the only disagreement of the adjectives, and the right one (the card had Switzerland)
        const person = {country: 'SI', international: false, bodies: ['Q35572'], media: false};
        expect(await countriesOf([row('UEFA', 'organization', 'Q35572'), row('Aleksander Čeferin', 'person', 'Q26819142'), row('Irish FA', 'organization', null)],
            {Q35572: UEFA, Q26819142: person})).toEqual(['IE']);
    });

    it('should not read a person, a place or a club of a short name for a country', async () => {
        expect(await countriesOf([row('Jordan Henderson', 'person', null), row('AS Roma', 'organization', null)], {})).toEqual([]);
    });
});

describe('namesAndCountriesOfCards, a country declined, a place looked for again', () => {
    const place = (name, lang, extra = {}) => ({...row(name, 'location', null, 2), id: 900, lang, ...extra});

    it('should give a card the country of a place with no item that is a country declined (the Polish locative of Spain)', async () => {
        expect(await countriesOf([place('Hiszpanii', 'pl'), row('Real Madrid', 'organization', null, 1)], {})).toEqual(['ES']);
    });

    it('should not read a place of an English news that starts like a country for it (Indiana is not India)', async () => {
        expect(await countriesOf([place('Indiana', 'en')], {})).toEqual([]);
    });

    it('should not ask Wikidata for a country declined, but for the place never looked for', async () => {
        MentionModel.want.mockClear();
        await countriesOf([place('Hiszpanii', 'pl'), {...place('Corse', 'fr'), id: 901}], {});
        expect(MentionModel.want).toHaveBeenCalledWith({ids: [901]});
    });

    it('should look again for a place that found no item before the rules of the places changed, not for one looked for since', async () => {
        MentionModel.want.mockClear();
        await countriesOf([{...place('Barcelona', 'es'), id: 902, linkedAt: new Date('2026-10-18T10:00:00Z')},
            {...place('Rome', 'fr'), id: 903, linkedAt: new Date('2026-11-12T10:00:00Z')}], {});
        expect(MentionModel.want).toHaveBeenCalledWith({ids: [902]});
    });
});
