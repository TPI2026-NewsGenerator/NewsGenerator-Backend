//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.read-channels.js
//  Description: The channels of an item of Wikidata and the names it is called by (its labels in the languages of the
//               news, its aliases, its short name), for the official source of a card: a party named in French by an
//               article is known without a search (the user, 2.11.2026)
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {readChannels} = await import('../../services/utils/wikidata.js');

const text = (value) => ({value});
const caf = {
    id: 'Q168360',
    labels: {en: text('Confederation of African Football'), fr: text('Confédération africaine de football'), ar: text('الاتحاد الأفريقي لكرة القدم'), de: text('Afrikanischer Fußballverband')},
    aliases: {en: [text('CAF'), text('African Football Confederation'), text('Football')], fr: [text('Confédération Africaine de Football')]},
    descriptions: {en: text('governing body of association football in Africa')},
    claims: {
        P31: [{mainsnak: {datavalue: {value: {id: 'Q4830453'}}}}],
        P856: [{mainsnak: {datavalue: {value: 'https://www.cafonline.com'}}}],
        P1813: [{mainsnak: {datavalue: {value: {text: 'CAF', language: 'en'}}}}],
    },
};
const psg = {
    id: 'Q483020', labels: {en: text('Paris Saint-Germain F.C.')}, aliases: {en: [text('PSG F.C.')]}, descriptions: {},
    claims: {P31: [{mainsnak: {datavalue: {value: {id: 'Q476028'}}}}], P1813: [{mainsnak: {datavalue: {value: {text: 'PSG', language: 'fr'}}}}]},
};

describe('readChannels', () => {
    it('should give the names an item is called by: its labels in the languages of the news, its aliases, its short name', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ok: true, status: 200, headers: new Headers(),
            json: async () => ({entities: {Q168360: caf, Q483020: psg, Q1: {id: 'Q1', missing: ''}}})});
        const items = await readChannels(['Q168360', 'Q483020', 'Q1', 'not a qid']);
        const asked = new URL(fetch.mock.calls[0][0]).searchParams;
        fetch.mockRestore();

        expect(asked.get('ids')).toBe('Q168360|Q483020|Q1');
        expect(asked.get('props')).toBe('labels|aliases|descriptions|claims');
        expect(asked.get('languages')).toBe('en|fr|de|es|it|pt|nl');
        expect(items.map(item => item.qid)).toEqual(['Q168360', 'Q483020']);
        expect(items[0]).toMatchObject({label: 'Confederation of African Football', description: 'governing body of association football in Africa',
            channels: {site: ['https://www.cafonline.com']}});
        // the labels, the short name, the aliases; no one-word alias ("Football"), no other alphabet, no name twice
        // whatever its case (the French alias is the French label)
        expect(items[0].names).toEqual(['Confederation of African Football', 'Confédération africaine de football', 'Afrikanischer Fußballverband',
            'CAF', 'African Football Confederation']);
    });

    it('should name a club without its "FC" too', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ok: true, status: 200, headers: new Headers(),
            json: async () => ({entities: {Q483020: psg}})});
        const [club] = await readChannels(['Q483020']);
        fetch.mockRestore();
        expect(club.names).toEqual(expect.arrayContaining(['Paris Saint-Germain F.C.', 'PSG', 'PSG F.C.', 'Paris Saint-Germain']));
    });
});
