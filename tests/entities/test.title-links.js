//
//  Author: Fabian Rostello
//  Date: 22.10.2026
//  File: test.title-links.js
//  Description: The names linked at once by the title of an article of their Wikipedia: persons in full and
//               places only, a page of homonyms, another kind of item, a common noun, a byline left to the
//               search
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const describeItems = jest.fn();
const sitesNaming = jest.fn(async () => [{site: 'lemonde.fr', news: 5}, {site: 'lequipe.fr', news: 4}]);
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, describeItems}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {sitesNaming, titlesNaming: jest.fn()}}));
const {articlesOf, linkedByTitle} = await import('../../services/utils/title-links.js');

// the answer of the Wikipedia of a language: titles asked -> pages (with their item), redirects, normalized
const answer = (pages, {redirects = [], normalized = []} = {}) => ({ok: true, json: async () => ({query: {pages, redirects, normalized}})});
const page = (title, qid, disambiguation = false) => ({title, pageprops: {wikibase_item: qid, ...(disambiguation ? {disambiguation: ''} : {})}});
const item = (qid, label, description, extra = {}) => ({qid, label, description, links: 20, human: false, place: false, work: false, ...extra});

let fetch;
beforeEach(() => {
    describeItems.mockReset();
    sitesNaming.mockClear();
    fetch = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => fetch.mockRestore());

describe('articlesOf', () => {
    it('should follow a redirect and a normalized title, ask the Wikipedia of the language, then English for the others', async () => {
        fetch.mockResolvedValueOnce(answer([page('Real Madrid CF', 'Q8682')], {redirects: [{from: 'Real Madrid', to: 'Real Madrid CF'}]}))
            .mockResolvedValueOnce(answer([page('Moss Side', 'Q2240567')]));
        const rows = [{id: 1, name: 'Real Madrid', lang: 'es'}, {id: 2, name: 'Moss Side', lang: 'es'}];
        const found = await articlesOf(rows);
        expect(found.get(1)).toMatchObject({qid: 'Q8682', title: 'Real Madrid CF', disambiguation: false});
        expect(found.get(2).qid).toBe('Q2240567');
        expect(fetch.mock.calls[0][0]).toContain('https://es.wikipedia.org/w/api.php');
        expect(fetch.mock.calls[0][0]).toContain('redirects=1');
        // not found in Spanish: asked again in English
        expect(fetch.mock.calls[1][0]).toContain('https://en.wikipedia.org/w/api.php');
        expect(fetch.mock.calls[1][0]).toContain('titles=Moss+Side');
    });

    it('should leave out what a Wikipedia does not answer, 50 titles a call', async () => {
        fetch.mockRejectedValue(new Error('network'));
        expect((await articlesOf([{id: 1, name: 'X Y', lang: 'xx'}])).size).toBe(0);
        fetch.mockReset();
        fetch.mockResolvedValue(answer([]));
        const rows = Array.from({length: 120}, (_, i) => ({id: i, name: `Name ${i}`, lang: 'en'}));
        await articlesOf(rows);
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});

describe('linkedByTitle', () => {
    it('should link a person in full to a human, a place to a place, and leave the others to the search', async () => {
        fetch.mockResolvedValueOnce(answer([page('James Rodríguez', 'Q1'), page('Diyarbakır', 'Q2'), page('Jack Miller', 'Q3', true),
            page('Trey McBride', 'Q4'), page('Motorsport', 'Q5'), page('Israelis', 'Q6'), page('Brücke', 'Q7')]));
        describeItems.mockResolvedValueOnce([
            item('Q1', 'James Rodríguez', 'Colombian association football player', {human: true}),
            item('Q2', 'Diyarbakır', 'city in Southeastern Anatolia, Turkey'),
            item('Q4', 'Trey McBride', 'American football player', {human: true}),
            item('Q5', 'motorsport', 'sporting competition and recreation'),
            item('Q6', 'Israelis', 'citizens and nationals of Israel'),
            item('Q7', 'Brücke', 'German expressionist artist group', {human: false}),
        ]);
        const rows = [
            {id: 1, name: 'James Rodríguez', kind: 'person', lang: 'en'}, {id: 2, name: 'Diyarbakır', kind: 'location', lang: 'en'},
            {id: 3, name: 'Jack Miller', kind: 'person', lang: 'en'}, {id: 4, name: 'Trey McBride', kind: 'person', lang: 'en'},
            {id: 5, name: 'Motorsport', kind: 'location', lang: 'en'}, {id: 6, name: 'Israelis', kind: 'location', lang: 'en'},
            {id: 7, name: 'Brücke', kind: 'location', lang: 'en'},
            // one word, an organisation, a family name after a particle: never asked
            {id: 8, name: 'Pedri', kind: 'person', lang: 'en'}, {id: 9, name: 'Napoli', kind: 'organization', lang: 'en'}, {id: 10, name: 'De Roon', kind: 'person', lang: 'en'},
        ];
        const linked = await linkedByTitle(rows);
        expect([...linked]).toEqual([[1, 'Q1'], [2, 'Q2'], [4, 'Q4']]);
        expect(fetch.mock.calls[0][0]).toContain('James+Rodr%C3%ADguez');
        expect(fetch.mock.calls[0][0]).not.toContain('Pedri');
        expect(fetch.mock.calls[0][0]).not.toContain('Napoli');
        expect(fetch.mock.calls[0][0]).not.toContain('De+Roon');
        expect(describeItems).toHaveBeenCalledWith(expect.arrayContaining(['Q1', 'Q2']), {batch: 50});
    });

    it('should leave a person one site writes the news of: a byline is not the person of that name', async () => {
        fetch.mockResolvedValueOnce(answer([page('Mohammed Ibrahim', 'Q9')]));
        describeItems.mockResolvedValueOnce([item('Q9', 'Mohammed Ibrahim', 'Egyptian businessman', {human: true})]);
        sitesNaming.mockResolvedValueOnce([{site: 'ysscores.com', news: 95}, {site: 'lemonde.fr', news: 5}]);
        expect((await linkedByTitle([{id: 1, name: 'Mohammed Ibrahim', kind: 'person', lang: 'en'}])).size).toBe(0);
    });

    it('should link a Korean or Japanese person by the article of the name as written, else of the name without what is glued to it', async () => {
        // "구자욱이" (a particle): no article in Korean nor in English as written, one for "구자욱"
        fetch.mockResolvedValueOnce(answer([])).mockResolvedValueOnce(answer([])).mockResolvedValueOnce(answer([page('구자욱', 'Q10')]));
        describeItems.mockResolvedValueOnce([item('Q10', 'Koo Ja-wook', 'South Korean baseball player', {human: true})]);
        const linked = await linkedByTitle([{id: 1, name: '구자욱이', kind: 'person', lang: 'ko'}]);
        expect([...linked]).toEqual([[1, 'Q10']]);
        const titles = fetch.mock.calls.map(call => new URL(call[0]).searchParams.get('titles'));
        expect(titles).toEqual(['구자욱이', '구자욱이', '구자욱']);
        expect(fetch.mock.calls[0][0]).toContain('https://ko.wikipedia.org/w/api.php');
        expect(fetch.mock.calls[2][0]).toContain('https://ko.wikipedia.org/w/api.php');
    });

    it('should ask the Wikipedia of the letters of a name, whatever the language kept with it', async () => {
        fetch.mockResolvedValueOnce(answer([page('손흥민', 'Q13')]));
        describeItems.mockResolvedValueOnce([item('Q13', 'Son Heung-min', 'South Korean footballer', {human: true})]);
        const linked = await linkedByTitle([{id: 1, name: '손흥민', kind: 'person', lang: null}]);
        expect([...linked]).toEqual([[1, 'Q13']]);
        expect(fetch.mock.calls[0][0]).toContain('https://ko.wikipedia.org/w/api.php');
    });

    it('should ask the form first only for the names of a Wikipedia that has them, and not look again for the ones found', async () => {
        // 大谷翔平 is an article as written; 森保監督 is none, its form 森保 is two han: a word alone, never asked
        fetch.mockResolvedValueOnce(answer([page('大谷翔平', 'Q11')])).mockResolvedValueOnce(answer([]));
        describeItems.mockResolvedValueOnce([item('Q11', 'Shohei Ohtani', 'Japanese baseball player', {human: true})]);
        const linked = await linkedByTitle([{id: 1, name: '大谷翔平', kind: 'person', lang: 'ja'}, {id: 2, name: '森保監督', kind: 'person', lang: 'ja'}]);
        expect([...linked]).toEqual([[1, 'Q11']]);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('titles')).toBe('大谷翔平|森保監督');
    });

    it('should ask nothing when no name is a person in full or a place', async () => {
        expect((await linkedByTitle([{id: 1, name: 'Napoli', kind: 'organization', lang: 'it'}, {id: 2, name: 'Pedri', kind: 'person', lang: 'es'}])).size).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
    });
});
