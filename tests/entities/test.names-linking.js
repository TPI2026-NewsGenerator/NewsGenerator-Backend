//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.names-linking.js
//  Description: A famous person or place among their namesakes of Wikidata, and a family name alone on
//               a card taken for the person linked who bears it
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {famousHuman, famousPlace, placeItem} = await import('../../services/utils/wikidata.js');
const {withSurnamesLinked} = await import('../../services/utils/card-names.js');

const answer = (body) => ({ok: true, status: 200, headers: new Headers(), json: async () => body});
const item = (id, human, links) => ({id, claims: {P31: [{mainsnak: {datavalue: {value: {id: human ? 'Q5' : 'Q482994'}}}}]},
    sitelinks: Object.fromEntries(Array.from({length: links}, (_, i) => [`wiki${i}`, {}]))});

describe('famousHuman', () => {
    it('should take the human far more known than the other ones, never a song of the same name', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({entities: {
            Q22686: item('Q22686', true, 334), Q1: item('Q1', false, 400), Q2: item('Q2', true, 6),
        }}));
        expect(await famousHuman(['Q1', 'Q22686', 'Q2'])).toBe('Q22686');
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('props')).toBe('claims|sitelinks');
        fetch.mockRestore();
    });

    it('should take none when no human stands out, or the most known is little known', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(answer({entities: {Q4333767: item('Q4333767', true, 20), Q2720825: item('Q2720825', true, 12)}}))
            .mockResolvedValueOnce(answer({entities: {Q1374752: item('Q1374752', true, 20), Q3: item('Q3', true, 2)}}))
            .mockResolvedValueOnce(answer({entities: {Q4: item('Q4', false, 200)}}));
        expect(await famousHuman(['Q4333767', 'Q2720825'])).toBeNull();
        expect(await famousHuman(['Q1374752', 'Q3'])).toBeNull();
        expect(await famousHuman(['Q4'])).toBeNull();
        expect(await famousHuman([])).toBeNull();
        expect(fetch).toHaveBeenCalledTimes(3);
        fetch.mockRestore();
    });
});

// a place: a position on Earth (P625)
const place = (id, links, human = false) => {
    const found = item(id, human, links);
    return {...found, claims: {...found.claims, P625: [{mainsnak: {datavalue: {value: {latitude: 48.8, longitude: 2.3}}}}]}};
};

describe('placeItem', () => {
    it('should take a country by its code, never the item called so by the search', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({query: {search: [{title: 'Q148'}]}}));
        expect(await placeItem('Chine', 'fr')).toBe('Q148');
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('srsearch')).toBe('haswbstatement:P297=CN');
        // known since: Wikidata is not asked again
        expect(await placeItem('China', 'en')).toBe('Q148');
        expect(fetch).toHaveBeenCalledTimes(1);
        fetch.mockRestore();
    });

    it('should take a place called so by one of its other names, the famous one of several', async () => {
        const named = (id, label, aliases = []) => ({id, labels: {en: {value: label}}, aliases: {en: aliases.map(value => ({value}))}});
        const fetch = jest.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(answer({search: [{id: 'Q830149', label: 'Paris'}, {id: 'Q7', label: 'Paris Hilton'}, {id: 'Q90', label: 'Paris'}]}))
            .mockResolvedValueOnce(answer({entities: {Q830149: named('Q830149', 'Paris'), Q7: named('Q7', 'Paris Hilton'),
                Q90: named('Q90', 'City of Paris', ['Paris'])}}))
            .mockResolvedValueOnce(answer({entities: {Q90: place('Q90', 366), Q830149: place('Q830149', 40)}}));
        expect(await placeItem('Paris', 'en')).toBe('Q90');
        expect(new URL(fetch.mock.calls[2][0]).searchParams.get('ids')).toBe('Q830149|Q90');
        fetch.mockRestore();
    });
});

describe('famousPlace', () => {
    it('should take the place far more known than the other places so called, never a thing nor a human', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({entities: {
            Q90: place('Q90', 366), Q830149: place('Q830149', 40), Q1: item('Q1', false, 900), Q2: place('Q2', 500, true),
        }}));
        expect(await famousPlace(['Q830149', 'Q1', 'Q90', 'Q2'])).toBe('Q90');
        fetch.mockRestore();
    });

    it('should take none when two places so called are both known, or the most known is little known', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(answer({entities: {Q61: place('Q61', 250), Q1223: place('Q1223', 200)}}))
            .mockResolvedValueOnce(answer({entities: {Q5: place('Q5', 20), Q6: place('Q6', 2)}}));
        expect(await famousPlace(['Q61', 'Q1223'])).toBeNull();
        expect(await famousPlace(['Q5', 'Q6'])).toBeNull();
        expect(await famousPlace([])).toBeNull();
        fetch.mockRestore();
    });
});

describe('withSurnamesLinked', () => {
    const rows = [
        {word: 'infantino', qid: 'Q124138', seen: 2680, asPerson: 1194, asOther: 453},
        {word: 'milan', qid: 'Q86530997', seen: 40, asPerson: 46, asOther: 7561},
        {word: 'trump', qid: 'Q22686', seen: 3106, asPerson: 18959, asOther: 50},
        {word: 'trump', qid: 'Q23000822', seen: 68, asPerson: 18959, asOther: 50},
        {word: 'smith', qid: 'Q10', seen: 300, asPerson: 900, asOther: 1},
        {word: 'smith', qid: 'Q11', seen: 200, asPerson: 900, asOther: 1},
    ];

    it("should take a family name alone for the person who bears it, as the card writes it, a person whatever the tagger said", () => {
        expect(withSurnamesLinked([[{name: 'Infantino', qid: null, kind: 'organization'}, {name: 'FIFA', qid: null, kind: 'organization'}],
            [{name: 'Trump', qid: null, kind: 'person'}]], rows)).toEqual([
            [{name: 'Infantino', qid: 'Q124138', kind: 'person', bySurname: 2680}, {name: 'FIFA', qid: null, kind: 'organization'}],
            [{name: 'Trump', qid: 'Q22686', kind: 'person', bySurname: 3106}],
        ]);
    });

    it('should keep a club named like someone, a name of two people as known, and one person once on a card', () => {
        expect(withSurnamesLinked([[{name: 'Milan', qid: null, kind: 'organization'}, {name: 'Smith', qid: null, kind: 'person'}]], rows))
            .toEqual([[{name: 'Milan', qid: null, kind: 'organization'}, {name: 'Smith', qid: null, kind: 'person'}]]);
        expect(withSurnamesLinked([[{name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'}, {name: 'Infantino', qid: null, kind: 'person'}]], rows))
            .toEqual([[{name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'}]]);
    });
});
