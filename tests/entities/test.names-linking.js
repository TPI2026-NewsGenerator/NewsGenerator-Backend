//
//  Author: Fabian Rostello
//  Date: 18.10.2026
//  File: test.names-linking.js
//  Description: A famous person among their namesakes of Wikidata, and a family name alone on a card
//               taken for the person linked who bears it
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {famousHuman} = await import('../../services/utils/wikidata.js');
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
