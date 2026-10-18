//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.countries.js
//  Description: The countries a card is of, from who and where it names, and their names shown
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {cardCountries} = await import('../../services/utils/countries.js');
const {countryNamed, countryNames} = await import('../../services/utils/country-names.js');

const countryOf = new Map([['Q22686', 'US'], ['Q15031', 'CN'], ['Q956', 'CN'], ['Q61', 'US'], ['Q865', 'TW'],
    ['Q1076', 'ZM'], ['Q3881', 'ZM'], ['Q9617', 'GB'], ['Q9616', 'GB'], ['Q124138', 'CH'], ['Q1201', 'FR']]
    .map(([qid, country]) => [qid, {country, international: false}]));
countryOf.set('Q253414', {country: null, international: true});

describe('cardCountries', () => {
    it('should show the main countries of a card naming people of several, the main first', () => {
        expect(cardCountries([{qid: 'Q22686', weight: 10}, {qid: 'Q15031', weight: 9}, {qid: 'Q956', weight: 5},
            {qid: 'Q61', weight: 3}, {qid: 'Q865', weight: 2}], countryOf)).toEqual(['CN', 'US']);
    });

    it('should show one country when its names are of one, and none for an international body', () => {
        expect(cardCountries([{qid: 'Q1076', weight: 6}, {qid: 'Q3881', weight: 3}, {qid: 'Q253414', weight: 8}], countryOf)).toEqual(['ZM']);
        expect(cardCountries([{qid: 'Q253414', weight: 8}, {qid: 'Q5', weight: 4}], countryOf)).toEqual([]);
        expect(cardCountries([], countryOf)).toEqual([]);
    });

    it('should leave out the people of a card naming an international body, not its clubs nor places', () => {
        expect(cardCountries([{qid: 'Q253414', weight: 8}, {qid: 'Q124138', weight: 6, person: true}], countryOf)).toEqual([]);
        expect(cardCountries([{qid: 'Q253414', weight: 8}, {qid: 'Q124138', weight: 6, person: true}, {qid: 'Q1201', weight: 3}], countryOf)).toEqual(['FR']);
        expect(cardCountries([{qid: 'Q124138', weight: 6, person: true}], countryOf)).toEqual(['CH']);
    });

    it('should count an item once, and a match of two clubs of one country as that country', () => {
        expect(cardCountries([{qid: 'Q9617', weight: 4}, {qid: 'Q9616', weight: 4}, {qid: 'Q9617', weight: 4}], countryOf)).toEqual(['GB']);
        expect(cardCountries([{qid: 'Q1076', weight: 4}, {qid: 'Q1076', weight: 4}, {qid: 'Q22686', weight: 3}], countryOf)).toEqual(['ZM', 'US']);
    });
});

describe('countryNamed', () => {
    it('should tell the country a name is, in the languages of the news, with its article or short', () => {
        expect(['Espagne', 'España', 'Spain', 'la France', 'Royaume-Uni', 'UK', 'USA', 'États-Unis', 'Deutschland', 'Ελλάδα', 'Россия',
            'Turquie', 'Turkey', 'Angleterre'].map(countryNamed)).toEqual(['ES', 'ES', 'ES', 'FR', 'GB', 'GB', 'US', 'US', 'DE', 'GR', 'RU',
            'TR', 'TR', 'GB']);
    });

    it('should tell none for a city, a continent or a short word', () => {
        expect(['Paris', 'Thun', 'Europe', 'Man', 'Nice', 'FC'].map(countryNamed)).toEqual([null, null, null, null, null, null]);
        expect(['US', 'U.S.', 'EE.UU.'].map(countryNamed)).toEqual(['US', 'US', 'US']);
    });
});

describe('countryNames', () => {
    it('should name the countries in the language asked', () => {
        expect(countryNames(['US', 'CN'], {titles: ['Trump et Xi se rencontrent'], locale: 'fr'})).toEqual(['États-Unis', 'Chine']);
        expect(countryNames(['ZM'], {titles: ['Hichilema dismisses his finance minister']})).toEqual(['Zambia']);
    });

    it('should show none when the title names every one of them already, in its language or the reader one', () => {
        expect(countryNames(['ZM'], {titles: ['La Zambie limoge son ministre'], languages: ['fr']})).toEqual([]);
        expect(countryNames(['ZM'], {titles: ['Le président zambien limoge son ministre'], languages: ['fr']})).toEqual([]);
        expect(countryNames(['US', 'CN'], {titles: ['Trump en Chine'], languages: ['fr']})).toEqual(['United States', 'China']);
        expect(countryNames(['US', 'CN'], {titles: ['Les États-Unis et la Chine signent'], languages: ['fr']})).toEqual([]);
        expect(countryNames([], {titles: ['x']})).toEqual([]);
    });
});
