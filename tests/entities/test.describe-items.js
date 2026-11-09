//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.describe-items.js
//  Description: The English label of an item of Wikidata (describeItems): Wikidata keeps the name of a person written the same in every Latin
//               language as a label of the language "mul", with none in English, so a call for English labels is made with the fallback of
//               languages: without it the label read was the number of the item (Q124138 for Gianni Infantino, 9.11.2026), and a card in
//               Russian kept his name in Cyrillic
//

import {afterEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {describeItems, readItem} = await import('../../services/utils/wikidata.js');

const answer = (entities) => ({ok: true, status: 200, headers: new Headers(), json: async () => ({entities})});
const infantino = {id: 'Q124138', labels: {en: {language: 'mul', 'for-language': 'en', value: 'Gianni Infantino'}}, descriptions: {en: {value: 'football administrator'}},
    claims: {P31: [{mainsnak: {datavalue: {value: {id: 'Q5'}}}}]}, sitelinks: {enwiki: {}}};
const nameless = {id: 'Q5', labels: {}, descriptions: {}, claims: {}, sitelinks: {}};

afterEach(() => jest.restoreAllMocks());

describe('describeItems', () => {
    it('should ask for the labels with the fallback of languages and give the label a person has as "mul"', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({Q124138: infantino}));
        const [item] = await describeItems(['Q124138']);
        const asked = new URL(fetch.mock.calls[0][0]).searchParams;
        expect(asked.get('languagefallback')).toBe('1');
        expect(asked.get('languages')).toBe('en');
        expect(item).toMatchObject({qid: 'Q124138', label: 'Gianni Infantino', human: true});
    });

    it('should give the number of the item when it has no label at all', async () => {
        jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({Q5: nameless}));
        const [item] = await describeItems(['Q5']);
        expect(item.label).toBe('Q5');
    });
});

describe('readItem', () => {
    it('should ask for the labels with the fallback of languages too', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(answer({Q124138: {...infantino, labels: {en: {language: 'mul', value: 'Gianni Infantino'}}}}));
        const item = await readItem('Q124138');
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('languagefallback')).toBe('1');
        expect(item.label).toBe('Gianni Infantino');
    });
});
