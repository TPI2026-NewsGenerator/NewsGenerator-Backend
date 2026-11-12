//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-leaders.js
//  Description: Tests for the presidents of the associations (FifaService.refreshLeaders): the page of each association on the site of FIFA first, with the item of
//               Wikidata of the person when Wikidata has the same one, else Wikidata alone; the site read once a week, not read again before; the presidents of
//               the week before kept when the site gives too few; FIFA_SITE_LEADERS=off reads none. The database and the network are mocked
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import process from 'node:process';
import {ASSOCIATIONS, memberOfFifa} from '../../services/utils/fifa-members.js';

process.env.FIFA_SITE_DELAY_MS = '0';
const model = Object.fromEntries(['subjects', 'leaders', 'replaceLeaders'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn(), newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})}));
const {FifaService} = await import('../../services/fifa-service.js');

const JAPAN = memberOfFifa('JPN');
const DENMARK = memberOfFifa('DEN');
const FRANCE = memberOfFifa('FRA');
const html = (name) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props: {pageProps: {association: {pageData: {hero: {association: {president: {label: 'President', value: name}}}}}}}})}</script>`;
// the site of FIFA: every association has a president "Person XXX" but Japan, whose page says "Kozo TASHIMA", and France, whose page has none
const site = (url) => {
    const code = /associations\/([A-Z]+)\/organisation/.exec(url)?.[1];
    if (code === 'FRA') return {ok: true, text: async () => '<html>no president named</html>'};
    return {ok: true, text: async () => html(code === 'JPN' ? 'Kozo TASHIMA' : `Person ${code}`)};
};
const wikidata = (rows) => ({ok: true, json: async () => ({results: {bindings: rows}})});
const binding = (member, person, label, start = '2022-06-01T00:00:00Z') => ({fa: {value: `http://www.wikidata.org/entity/${member.qid}`}, person: {value: `http://www.wikidata.org/entity/${person}`}, personLabel: {value: label}, start: {value: start}});
let fetched;

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    model.leaders.mockResolvedValue([]);
    model.replaceLeaders.mockResolvedValue(undefined);
    delete process.env.FIFA_SITE_LEADERS;
    fetched = [];
    globalThis.fetch = jest.fn(async (url) => {
        fetched.push(String(url));
        if (String(url).includes('query.wikidata.org')) return wikidata([binding(JAPAN, 'Q100', 'Kozo Tashima'), binding(DENMARK, 'Q200', 'Jesper Møller'), binding(FRANCE, 'Q300', 'Philippe Diallo')]);
        return site(String(url));
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

const saved = () => model.replaceLeaders.mock.calls.at(-1)[0];
const of = (list, member) => list.find(row => row.member_qid === member.qid);

describe('FifaService.refreshLeaders', () => {
    it('should take the president of the site of FIFA, with the item of Wikidata only when Wikidata has the same person', async () => {
        await FifaService.refreshLeaders();
        const leaders = saved();
        expect(of(leaders, JAPAN)).toMatchObject({name: 'Kozo Tashima', person_qid: 'Q100', source: 'fifa', source_url: 'https://inside.fifa.com/en/associations/JPN/organisation', since: '2022-06-01'});
        // the site says "Person DEN", Wikidata "Jesper Møller": two people, the item of Wikidata is not his
        expect(of(leaders, DENMARK)).toMatchObject({name: 'Person Den', person_qid: null, source: 'fifa'});
        expect(leaders.filter(row => row.source === 'fifa')).toHaveLength(ASSOCIATIONS.length - 1);
    });

    it('should keep the president of Wikidata for an association whose page names none', async () => {
        await FifaService.refreshLeaders();
        expect(of(saved(), FRANCE)).toMatchObject({name: 'Philippe Diallo', person_qid: 'Q300', source: 'wikidata', source_url: ''});
    });

    it('should not read the site again before a week, and carry the presidents it gave', async () => {
        const week = new Date(Date.now() - 2 * 864e5);
        model.leaders.mockResolvedValue(ASSOCIATIONS.map(member => ({member_qid: member.qid, person_qid: null, name: `Kept ${member.fifa}`, role: 'President', since: null, source: 'fifa',
            source_url: `https://inside.fifa.com/en/associations/${member.fifa}/organisation`, checked_at: week})));
        await FifaService.refreshLeaders();
        expect(fetched.filter(url => url.includes('inside.fifa.com'))).toHaveLength(0);
        expect(of(saved(), DENMARK)).toMatchObject({name: 'Kept DEN', source: 'fifa'});
    });

    it('should read the site again when the last reading is more than a week old', async () => {
        const old = new Date(Date.now() - 9 * 864e5);
        model.leaders.mockResolvedValue([{member_qid: DENMARK.qid, person_qid: null, name: 'Old Name', role: 'President', since: null, source: 'fifa', source_url: '', checked_at: old}]);
        await FifaService.refreshLeaders();
        expect(fetched.filter(url => url.includes('inside.fifa.com')).length).toBe(ASSOCIATIONS.length);
        expect(of(saved(), DENMARK)).toMatchObject({name: 'Person Den'});
    });

    it('should keep the presidents of the week before when the site gives too few, and say so', async () => {
        const old = new Date(Date.now() - 9 * 864e5);
        model.leaders.mockResolvedValue([{member_qid: DENMARK.qid, person_qid: null, name: 'Last Week', role: 'President', since: null, source: 'fifa', source_url: '', checked_at: old}]);
        globalThis.fetch = jest.fn(async (url) => String(url).includes('query.wikidata.org') ? wikidata([]) : {ok: false, status: 503, text: async () => ''});
        await FifaService.refreshLeaders();
        expect(of(saved(), DENMARK)).toMatchObject({name: 'Last Week', source: 'fifa'});
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('kept the ones of before'));
    });

    it('should read no page of the site with FIFA_SITE_LEADERS=off', async () => {
        process.env.FIFA_SITE_LEADERS = 'off';
        await FifaService.refreshLeaders();
        expect(fetched.filter(url => url.includes('inside.fifa.com'))).toHaveLength(0);
        expect(saved().every(row => row.source === 'wikidata')).toBe(true);
        expect(saved()).toHaveLength(3);
    });

    it('should not write when Wikidata and the site give nobody, and keep what the table holds', async () => {
        globalThis.fetch = jest.fn(async (url) => String(url).includes('query.wikidata.org') ? wikidata([]) : {ok: false, status: 503, text: async () => ''});
        await FifaService.refreshLeaders();
        expect(model.replaceLeaders).not.toHaveBeenCalled();
    });
});
