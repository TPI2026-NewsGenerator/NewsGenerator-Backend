//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.countries.js
//  Description: The countries a card is of, from who and where it names, the people of an international
//               body left out, and their names shown
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {cardCountries} = await import('../../services/utils/countries.js');
const {countryNamed, countryNames} = await import('../../services/utils/country-names.js');
const {readCountries} = await import('../../services/utils/wikidata.js');

const countryOf = new Map([['Q22686', 'US'], ['Q15031', 'CN'], ['Q956', 'CN'], ['Q61', 'US'], ['Q865', 'TW'],
    ['Q1076', 'ZM'], ['Q3881', 'ZM'], ['Q9617', 'GB'], ['Q9616', 'GB'], ['Q124138', 'CH'], ['Q1201', 'FR']]
    .map(([qid, country]) => [qid, {country, international: false}]));
countryOf.set('Q253414', {country: null, international: true});
countryOf.set('Q35572', {country: null, international: true});
// Infantino of FIFA (Swiss), Ramon Vega running against him (Swiss too), Horatiu Fesnic a Romanian referee
countryOf.set('Q124138', {country: 'CH', international: false, bodies: ['Q253414', 'Q40970']});
countryOf.set('Q2135316', {country: 'CH', international: false, bodies: []});
countryOf.set('Q42907713', {country: 'RO', international: false, bodies: []});
countryOf.set('Q490', {country: 'IT', international: false});

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

    it('should leave out the people of an international body the card names, not its clubs nor places', () => {
        expect(cardCountries([{qid: 'Q253414', weight: 8}, {qid: 'Q124138', weight: 6, person: true}], countryOf)).toEqual([]);
        expect(cardCountries([{qid: 'Q253414', weight: 8}, {qid: 'Q124138', weight: 6, person: true}, {qid: 'Q1201', weight: 3}], countryOf)).toEqual(['FR']);
        expect(cardCountries([{qid: 'Q124138', weight: 6, person: true}], countryOf)).toEqual(['CH']);
        // a card naming UEFA only: Infantino is of FIFA, not of UEFA any more
        expect(cardCountries([{qid: 'Q35572', weight: 8}, {qid: 'Q124138', weight: 6, person: true}], countryOf)).toEqual(['CH']);
    });

    it('should keep the country of the other people of a card naming an international body', () => {
        // "Românul Feșnic și brigada lui, protagoniști pe paginile UEFA": Romania, and Milan where he referees
        expect(cardCountries([{qid: 'Q42907713', weight: 1, person: true}, {qid: 'Q35572', weight: 1}, {qid: 'Q490', weight: 1}], countryOf))
            .toEqual(['RO', 'IT']);
        expect(cardCountries([{qid: 'Q253414', weight: 2}, {qid: 'Q124138', weight: 2, person: true}, {qid: 'Q2135316', weight: 2, person: true}],
            countryOf)).toEqual(['CH']);
        expect(cardCountries([{qid: 'Q253414', weight: 5}, {qid: 'Q124138', weight: 5, person: true}, {qid: 'Q22686', weight: 4, person: true}],
            countryOf)).toEqual(['US']);
    });

    it('should count an item once, and a match of two clubs of one country as that country', () => {
        expect(cardCountries([{qid: 'Q9617', weight: 4}, {qid: 'Q9616', weight: 4}, {qid: 'Q9617', weight: 4}], countryOf)).toEqual(['GB']);
        expect(cardCountries([{qid: 'Q1076', weight: 4}, {qid: 'Q1076', weight: 4}, {qid: 'Q22686', weight: 3}], countryOf)).toEqual(['ZM', 'US']);
    });
});

describe('readCountries', () => {
    const value = (id) => ({rank: 'normal', mainsnak: {datavalue: {value: {id}}}});
    const code = (iso) => ({rank: 'normal', mainsnak: {datavalue: {value: iso}}});
    const ended = (claim) => ({...claim, qualifiers: {P582: [{datavalue: {value: {time: '+2016-00-00T00:00:00Z'}}}]}});
    const held = (position, body) => ({...value(position), qualifiers: {P2389: [{datavalue: {value: {id: body}}}]}});
    const ITEMS = {
        // Infantino: works for FIFA, worked for UEFA; Ceferin: president of UEFA; Fesnic: a referee
        Q124138: {P31: [value('Q5')], P27: [value('Q39')], P108: [value('Q253414'), ended(value('Q35572'))]},
        Q26819142: {P31: [value('Q5')], P27: [value('Q215')], P39: [held('Q1255921', 'Q35572'), ended(held('Q1255921', 'Q725496'))]},
        Q42907713: {P31: [value('Q5')], P27: [value('Q218')]},
        // the French federation is UEFA's (parent organisation) and French; the FIFA Council part of FIFA
        Q244750: {P31: [value('Q1478443')], P749: [value('Q35572')], P17: [value('Q142')]},
        Q1388490: {P31: [value('Q43229')], P361: [value('Q253414')], P17: [value('Q39')]},
        Q253414: {P31: [value('Q11422536')], P17: [value('Q39')]},
        Q35572: {P31: [value('Q11422536')], P17: [value('Q39')]},
        Q39: {P297: [code('CH')]}, Q215: {P297: [code('SI')]}, Q218: {P297: [code('RO')]}, Q142: {P297: [code('FR')]},
    };
    const answer = (url) => ({ok: true, status: 200, headers: new Headers(), json: async () => ({entities: Object.fromEntries(
        new URL(url).searchParams.get('ids').split('|').map(qid => [qid, {id: qid, claims: ITEMS[qid]}]))})});

    it('should tell the bodies a person is of still, and a national federation of its country', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => answer(url));
        const read = await readCountries(['Q124138', 'Q26819142', 'Q42907713', 'Q244750', 'Q1388490', 'Q35572']);
        expect(read.get('Q124138')).toEqual({country: 'CH', international: false, bodies: ['Q253414']});
        expect(read.get('Q26819142')).toEqual({country: 'SI', international: false, bodies: ['Q35572']});
        expect(read.get('Q42907713')).toEqual({country: 'RO', international: false, bodies: []});
        expect(read.get('Q244750')).toEqual({country: 'FR', international: false, bodies: []});
        expect(read.get('Q1388490')).toEqual({country: null, international: true, bodies: []});
        expect(read.get('Q35572')).toEqual({country: null, international: true, bodies: []});
        fetch.mockRestore();
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
