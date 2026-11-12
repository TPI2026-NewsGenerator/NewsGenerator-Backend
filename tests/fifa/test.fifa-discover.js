//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-discover.js
//  Description: Tests for the candidates the news name that the map adds by itself (FifaService.discover): the persons named as candidates in the news are judged by two
//               models and added only when both say it in enough media, never over a full map, never one an administrator took off. The database, Wikidata and the AI are mocked
//

import {setTimeout as sleep} from 'node:timers/promises';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const model = Object.fromEntries(['subjects', 'dismissed', 'discoveryNews', 'personsOfArticles', 'addSubject', 'deleteSubject', 'news', 'markChecked', 'linkedNames', 'mentionNames',
    'knownHashes', 'insertSignal', 'unconfirmed', 'expireSources', 'pendingSources', 'expirePages', 'pendingPages'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const wikidata = {searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})};
jest.unstable_mockModule('../../services/utils/wikidata.js', () => wikidata);
const {FifaService} = await import('../../services/fifa-service.js');

const INFANTINO = {qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino'], status: 'incumbent', color_index: 1, origin: 'seed'};
const TASHIMA = {qid: 'Q2633169', name: 'Kozo Tashima'};
const BLATTER = {qid: 'Q483437', name: 'Sepp Blatter'};
let id = 0;
const media = ['bbc.co.uk', 'lemonde.fr', 'welt.de', 'marca.com', 'gazzetta.it', 'nrc.nl'];
// one candidacy sentence about a person in each of `count` media
const newsAbout = (person, count, text) => media.slice(0, count).map(medium => ({id: ++id, title: '', description: '', text, lang: 'en', medium, at: '2026-11-10T10:00:00Z', person}));
const TASHIMA_TEXT = 'Kozo Tashima, nominated by the JFA, will run for the FIFA presidency.';
const BLATTER_TEXT = 'Sepp Blatter attacked the FIFA president Infantino, saying he is a candidate for nothing.';
const set = (news) => {
    model.discoveryNews.mockResolvedValue(news);
    model.personsOfArticles.mockResolvedValue(news.map(item => ({id: item.id, ...item.person})));
};
const answers = (byName) => ollamaJson.mockImplementation(async (prompt) => {
    const name = Object.keys(byName).find(one => String(prompt).includes(`Person: ${one}`));
    return byName[name];
});

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    ollamaJson.mockReset();
    wikidata.describeItems.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    model.subjects.mockResolvedValue([INFANTINO]);
    model.dismissed.mockResolvedValue(new Set());
    model.addSubject.mockImplementation(async ({qid, name, status}) => [{qid, name, status, state: 'computing', color_index: 2}]);
    model.news.mockResolvedValue([]);
    model.unconfirmed.mockResolvedValue([]);
    model.expireSources.mockResolvedValue(0);
    model.pendingSources.mockResolvedValue([]);
    model.expirePages.mockResolvedValue(0);
    model.pendingPages.mockResolvedValue([]);
    wikidata.describeItems.mockImplementation(async ([qid]) => [{qid, label: qid === TASHIMA.qid ? 'Kozo Tashima' : 'Sepp Blatter', human: true}]);
});

// a candidate added starts a reading of the news in the background: let it end before the test does
afterEach(() => sleep(30));

// the module keeps who it judged for half a day: each test asks about another person
describe('FifaService.discover', () => {
    it('should add a candidate both models say is declared, in enough media, as a candidate of the news with what was found', async () => {
        set(newsAbout(TASHIMA, 3, TASHIMA_TEXT));
        answers({'Kozo Tashima': {status: 'declared', quote: 'will run for the FIFA presidency'}});
        const answer = await FifaService.discover();
        expect(answer.added).toEqual([expect.objectContaining({qid: TASHIMA.qid, status: 'declared', media: 3})]);
        expect(ollamaJson).toHaveBeenCalledTimes(2);
        expect(model.addSubject).toHaveBeenCalledWith(expect.objectContaining({qid: TASHIMA.qid, name: 'Kozo Tashima', terms: ['tashima'], status: 'declared', userId: null, origin: 'news',
            found: expect.objectContaining({status: 'declared', articles: 3, media: 3, quote: 'will run for the FIFA presidency'})}));
    });

    it('should add nobody a model says is not a candidate, and ask the second model only when the first says yes', async () => {
        set(newsAbout(BLATTER, 3, BLATTER_TEXT));
        answers({'Sepp Blatter': {status: 'no', quote: ''}});
        const answer = await FifaService.discover();
        expect(answer.added).toEqual([]);
        expect(answer.judged).toEqual([expect.objectContaining({qid: BLATTER.qid, add: false, why: 'not_a_candidate'})]);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect(model.addSubject).not.toHaveBeenCalled();
    });

    it('should not even ask about a person named in one medium only, nor judge a person again within half a day', async () => {
        const one = [{...newsAbout({qid: 'Q777', name: 'Jan Novak'}, 1, 'Jan Novak will run for the FIFA presidency.')[0]}];
        set(one);
        expect((await FifaService.discover()).judged).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
        const again = [{qid: 'Q888', name: 'Pedro Silva'}];
        set(newsAbout(again[0], 2, 'Pedro Silva will run for the FIFA presidency.'));
        answers({'Pedro Silva': {status: 'no', quote: ''}});
        await FifaService.discover();
        const calls = ollamaJson.mock.calls.length;
        await FifaService.discover();
        expect(ollamaJson.mock.calls.length).toBe(calls);
    });

    it('should leave out the persons already on the map and the ones an administrator took off', async () => {
        set(newsAbout({qid: 'Q999', name: 'Ana Costa'}, 3, 'Ana Costa will run for the FIFA presidency.'));
        model.dismissed.mockResolvedValue(new Set(['Q999']));
        const answer = await FifaService.discover();
        expect(answer.persons).toBe(0);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should say what it would add and write nothing without apply', async () => {
        set(newsAbout({qid: 'Q555', name: 'Luis Rey'}, 3, 'Luis Rey will run for the FIFA presidency.'));
        answers({'Luis Rey': {status: 'declared', quote: 'will run for the FIFA presidency'}});
        const answer = await FifaService.discover({apply: false});
        expect(answer.judged[0]).toMatchObject({qid: 'Q555', add: true, status: 'declared'});
        expect(answer.added).toEqual([]);
        expect(model.addSubject).not.toHaveBeenCalled();
    });

    it('should add nobody when the map is full: no candidate takes the place of another', async () => {
        model.subjects.mockResolvedValue(Array.from({length: 6}, (_, at) => ({...INFANTINO, qid: `Q${at + 10}`, status: 'withdrawn'})));
        set(newsAbout({qid: 'Q444', name: 'Eva Berg'}, 3, 'Eva Berg will run for the FIFA presidency.'));
        answers({'Eva Berg': {status: 'declared', quote: 'will run for the FIFA presidency'}});
        const answer = await FifaService.discover();
        expect(answer.full).toBe(true);
        expect(model.addSubject).not.toHaveBeenCalled();
        expect(model.deleteSubject).not.toHaveBeenCalled();
    });

    it('should judge again later a person whose model gave no answer, and add nobody for it', async () => {
        set(newsAbout({qid: 'Q333', name: 'Tom Hill'}, 3, 'Tom Hill will run for the FIFA presidency.'));
        ollamaJson.mockRejectedValue(new Error('busy'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const answer = await FifaService.discover();
        warn.mockRestore();
        expect(answer.judged[0]).toMatchObject({add: false, why: 'unread'});
        ollamaJson.mockResolvedValue({status: 'no', quote: ''});
        expect((await FifaService.discover()).judged).toHaveLength(1);
    });
});
