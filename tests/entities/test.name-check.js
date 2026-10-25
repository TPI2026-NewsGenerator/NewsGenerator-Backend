//
//  Author: Fabian Rostello
//  Date: 21.10.2026
//  File: test.name-check.js
//  Description: The names of a card checked against its titles: asked to the AI for the items in few
//               Wikipedias only, the link of a name the AI says is another thing left out, whatever fails
//               leaving the name as it was
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const describeItems = jest.fn();
const exactItems = jest.fn(async () => []);
const searchedItems = jest.fn(async () => []);
const countriesOfItems = jest.fn(async () => new Map());
const ollamaJson = jest.fn();
const candidatesOf = jest.fn(async () => new Map());
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, describeItems, exactItems}));
jest.unstable_mockModule('../../services/utils/wikipedia-search.js', () => ({searchedItems}));
jest.unstable_mockModule('../../services/utils/countries.js', () => ({countriesOfItems}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {candidatesOf}}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {CHECK_MAX_LINKS, PERSON_LEAST, checkPrompt, countriesOfSites, expansionOf, linkPrompt, mainCountryOfSites, withNamesChecked, withNamesLinked} = await import('../../services/utils/name-check.js');

const cards = [{storyId: 1, titles: ['Hernández Hernández, árbitro de Primera división: "El arbitraje es aprender a resetear"']}];
const MALTA = {qid: 'Q58305', label: 'Maltese First Division', description: 'sports league', links: 14, human: false};
const UEFA = {qid: 'Q35572', label: 'UEFA', description: 'governing body', links: 127, human: false};
const read = () => [{storyId: 1, names: [{name: 'Primera División', qid: 'Q58305', kind: 'organization'}, {name: 'UEFA', qid: 'Q35572', kind: 'organization'},
    {name: 'Hernandez Hernandez', qid: null, kind: 'person'}], places: [{name: 'Malta', qid: 'Q233', kind: 'location'}]}];

beforeEach(() => {
    describeItems.mockReset();
    ollamaJson.mockReset();
    countriesOfItems.mockClear();
    candidatesOf.mockReset();
    candidatesOf.mockResolvedValue(new Map());
    exactItems.mockReset();
    exactItems.mockResolvedValue([]);
    searchedItems.mockReset();
    searchedItems.mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('withNamesChecked', () => {
    it('should leave the link of a name the AI says is another thing, and ask only for items in few Wikipedias', async () => {
        describeItems.mockImplementation(async (qids) => [MALTA, UEFA, {qid: 'Q233', label: 'Malta', description: 'country', links: 300, human: false}]
            .filter(item => qids.includes(item.qid)));
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        const [card] = await withNamesChecked(read(), cards);
        expect(card.names.map(name => name.qid)).toEqual([null, 'Q35572', null]);
        // UEFA (127) and Malta (300) are above the limit: one call
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('"Primera División" (organization)');
        expect(prompt).toContain('Maltese First Division: sports league (14 Wikipedias');
        expect(prompt).toContain('- Hernández Hernández, árbitro de Primera división');
        expect(CHECK_MAX_LINKS).toBe(60);
    });

    it('should keep the link when the AI says yes or unsure, answers badly or fails', async () => {
        describeItems.mockResolvedValue([MALTA]);
        const rows = () => [{storyId: 1, names: [{name: 'Primera División', qid: 'Q58305', kind: 'organization'}], places: []}];
        for (const answer of [{same: 'yes'}, {same: 'unsure'}, {same: 'maybe'}, null]) {
            ollamaJson.mockResolvedValueOnce(answer);
            expect((await withNamesChecked(rows(), cards))[0].names[0].qid).toBe('Q58305');
        }
        ollamaJson.mockRejectedValueOnce(new Error('no answer'));
        expect((await withNamesChecked(rows(), cards))[0].names[0].qid).toBe('Q58305');
    });

    it('should leave the names as they are when Wikidata cannot describe the items, and when the card has no title', async () => {
        describeItems.mockRejectedValue(new Error('Wikidata asked to wait.'));
        const [card] = await withNamesChecked([{storyId: 2, names: [{name: 'X', qid: 'Q1', kind: 'organization'}], places: []}], [{storyId: 2, titles: ['t']}]);
        expect(card.names[0].qid).toBe('Q1');
        expect(ollamaJson).not.toHaveBeenCalled();
        describeItems.mockReset();
        await withNamesChecked([{storyId: 3, names: [{name: 'X', qid: 'Q1', kind: 'organization'}], places: []}], [{storyId: 3, titles: []}]);
        expect(describeItems).not.toHaveBeenCalled();
    });

    it('should drop a place the AI says is another thing from the places of the card', async () => {
        describeItems.mockResolvedValue([{qid: 'Q9', label: 'Dmbx1', description: 'gene', links: 0, human: false}]);
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        const [card] = await withNamesChecked([{storyId: 1, names: [], places: [{name: 'CDMX', qid: 'Q9', kind: 'location'}]}], cards);
        expect(card.places).toEqual([]);
    });

    it('should tell the AI the countries of the sites of the card by their names', async () => {
        expect(countriesOfSites(['2424.mg', 'newsmada.com', 'lemonde.fr', 'newsmada.mg'])).toBe('Madagascar (2), France (1)');
        expect(countriesOfSites([])).toBe('');
        describeItems.mockResolvedValue([MALTA]);
        ollamaJson.mockResolvedValueOnce({same: 'yes'});
        await withNamesChecked(read().map(card => ({...card, names: [card.names[0]], places: []})), [{...cards[0], sites: ['marca.com', 'as.es']}]);
        expect(ollamaJson.mock.calls[0][0]).toContain('Countries of the sites that published them: Spain (1)');
    });

    it('should tell the AI what the card is about and the other names on it', async () => {
        describeItems.mockResolvedValue([MALTA]);
        ollamaJson.mockResolvedValueOnce({same: 'yes'});
        const card = {storyId: 1, names: [{name: 'Primera División', qid: 'Q58305', kind: 'organization'}, {name: 'Hernandez Hernandez', qid: null, kind: 'person'}, {name: 'UEFA', qid: null, kind: 'organization'}], places: []};
        await withNamesChecked([card], [{...cards[0], topic: 'sport'}]);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('The card is about: sport.');
        expect(prompt).toContain('Other names on the card: Hernandez Hernandez, UEFA.');
        expect(prompt).not.toContain('Other names on the card: Primera División');
        // nothing said when the card tells nothing
        expect(checkPrompt({name: 'X', kind: 'person', titles: ['t'], label: 'X', description: '', links: 1})).not.toContain('The card is about');
    });

    it('should write the prompt with the country of the item when it has one', () => {
        expect(checkPrompt({name: 'OL', kind: 'organization', titles: ['t'], label: 'Open Library', description: 'online project', links: 41, country: 'US'}))
            .toContain('Open Library: online project (41 Wikipedias, country United States)');
    });
});

describe('withNamesLinked', () => {
    const NAPOLI = {qid: 'Q61', label: 'SSC Napoli', description: 'Italian professional football club', links: 118, human: false};
    const CITY = {qid: 'Q62', label: 'Naples', description: 'capital city of Campania, Italy', links: 207, human: false};
    const NAMESAKE = {qid: 'Q63', label: 'Osvaldo Di Carlo', description: 'Argentine sports leader', links: 1, human: true};
    const KNOWN = {qid: 'Q64', label: 'Michael Oliver', description: 'English football referee', links: 36, human: true};
    const sports = {storyId: 1, titles: ["Champions, scelti gli arbitri per Roma e Napoli"], sites: ['gazzetta.it', 'corriere.it'], topic: 'sport'};
    const names = () => [{name: 'Napoli', id: 10, qid: null, kind: 'organization'}, {name: 'Di Carlo', id: 11, qid: null, kind: 'person'},
        {name: 'Michael Oliver', id: 12, qid: null, kind: 'person'}, {name: 'Pedri', id: 13, qid: null, kind: 'person'},
        {name: 'UEFA', id: 14, qid: 'Q35572', kind: 'organization'}, {name: 'Schärer', id: 15, qid: null, kind: 'person'}];

    it('should link a name with no item to the candidate the card chooses, a person in 2 Wikipedias at least', async () => {
        candidatesOf.mockResolvedValue(new Map([[10, ['Q62', 'Q61']], [11, ['Q63']], [12, ['Q64']], [13, ['Q69']]]));
        describeItems.mockImplementation(async (qids) => [NAPOLI, CITY, NAMESAKE, KNOWN].filter(item => qids.includes(item.qid)));
        ollamaJson.mockResolvedValueOnce({n: 2}).mockResolvedValueOnce({n: 1}).mockResolvedValueOnce({n: 1});
        const [card] = await withNamesLinked([{storyId: 1, names: names(), places: []}], [sports]);
        const qids = Object.fromEntries(card.names.map(name => [name.name, name.qid]));
        expect(qids).toEqual({Napoli: 'Q61', 'Di Carlo': null, 'Michael Oliver': 'Q64', Pedri: null, UEFA: 'Q35572', Schärer: null});
        // asked for the three that have candidates and are no word alone: not Pedri, not UEFA (linked), not Schärer (none kept)
        expect(ollamaJson).toHaveBeenCalledTimes(3);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('The card these news make is about: sport.');
        expect(prompt).toContain('Other names on the card: Di Carlo, Michael Oliver, Pedri, UEFA, Schärer.');
        expect(prompt).toContain('Countries of the sites that published the news: Italy (2).');
        expect(prompt).toContain('[1] Naples: capital city of Campania, Italy (207 Wikipedias)');
        expect(prompt).toContain('[2] SSC Napoli: Italian professional football club (118 Wikipedias)');
        expect(PERSON_LEAST).toBe(2);
    });

    it('should leave the names as they are when the AI answers none or badly, or fails, and when nothing is kept', async () => {
        candidatesOf.mockResolvedValue(new Map([[10, ['Q61']]]));
        describeItems.mockResolvedValue([NAPOLI]);
        const card = () => [{storyId: 1, names: [{name: 'Napoli', id: 10, qid: null, kind: 'organization'}], places: []}];
        for (const answer of [{n: 0}, {n: 5}, {n: 'x'}, null]) {
            ollamaJson.mockResolvedValueOnce(answer);
            expect((await withNamesLinked(card(), [sports]))[0].names[0].qid).toBeNull();
        }
        ollamaJson.mockRejectedValueOnce(new Error('no answer'));
        expect((await withNamesLinked(card(), [sports]))[0].names[0].qid).toBeNull();
        candidatesOf.mockRejectedValue(new Error('database down'));
        expect((await withNamesLinked(card(), [sports]))[0].names[0].qid).toBeNull();
        candidatesOf.mockResolvedValue(new Map());
        ollamaJson.mockClear();
        await withNamesLinked(card(), [sports]);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should write the prompt without what the card does not tell', () => {
        const prompt = linkPrompt({name: 'OL', kind: 'organization', titles: ['t'], candidates: [{label: 'Open Library', description: '', links: 41}]});
        expect(prompt).toContain('The card these news make is about: unknown.');
        expect(prompt).toContain('Other names on the card: none.');
        expect(prompt).toContain('[1] Open Library: (no description) (41 Wikipedias)');
    });
});

describe('a name the check sent away', () => {
    const MALAGASY = {qid: 'Q900', label: 'Malagasy Football Federation', description: 'governing body of association football in Madagascar', links: 22, human: false};
    const MOLDOVAN = {qid: 'Q738074', label: 'Football Association of Moldova', description: 'association football governing body of Moldova', links: 25, human: false};
    const MEXICAN = {qid: 'Q901', label: 'Mexican Football Federation', description: 'governing body of association football in Mexico', links: 33, human: false};
    const malagasy = {storyId: 1, titles: ['FOOTBALL – Des représentants de clubs intègrent le collège électoral pour élire les dirigeants de la FMF'], sites: ['2424.mg'], topic: 'sport', language: 'fr',
        text: 'Les changements ont été adoptés lors de l’Assemblée générale ordinaire de la Fédération malgache de football (FMF), tenue samedi à Carion.'};
    const fmf = () => [{storyId: 1, names: [{name: 'FMF', id: 20, qid: 'Q738074', kind: 'organization'}], places: []}];

    it('should find the name a text spells out, and the acronym only', () => {
        expect(expansionOf('FMF', malagasy.text)).toBe('Fédération malgache de football');
        expect(expansionOf('FMF', 'La Fédération Mexicaine de Football (FMF) a annoncé')).toBe('Fédération Mexicaine de Football');
        expect(expansionOf('UEFA', 'Union of European Football Associations (UEFA)')).toBe('Union of European Football Associations');
        // not defined there, or defined as another name
        expect(expansionOf('FMF', 'Le président de la FMF a parlé')).toBeNull();
        expect(expansionOf('FMF', 'la Fédération royale marocaine (FMF)')).toBeNull();
        expect(expansionOf('X', 'a b (X)')).toBeNull();
        expect(expansionOf('FMF', '')).toBeNull();
        expect(mainCountryOfSites(['2424.mg', 'newsmada.mg', 'lemonde.fr'])).toBe('Madagascar');
        expect(mainCountryOfSites(['bbc.com'])).toBeNull();
    });

    it('should keep out the item it refused for the name, and link the one its card points to', async () => {
        describeItems.mockImplementation(async (qids) => [MOLDOVAN, MALAGASY, MEXICAN].filter(item => qids.includes(item.qid)));
        // the check says no; the text spells the name out; the search with the country finds the Mexican one too
        ollamaJson.mockResolvedValueOnce({same: 'no'}).mockResolvedValueOnce({n: 1});
        exactItems.mockResolvedValue(['Q900']);
        searchedItems.mockResolvedValue(['Q901', 'Q738074', 'Q900']);
        candidatesOf.mockResolvedValue(new Map([[20, ['Q738074']]]));
        const [card] = await withNamesLinked(await withNamesChecked(fmf(), [malagasy]), [malagasy]);
        expect(card.names[0].qid).toBe('Q900');
        expect(exactItems).toHaveBeenCalledWith('Fédération malgache de football', 'fr');
        expect(searchedItems).toHaveBeenCalledWith('FMF Madagascar');
        // the candidates: the spelled-out name first, then the search, the refused item (the Moldovan federation) in none
        const prompt = ollamaJson.mock.calls[1][0];
        expect(prompt).toContain('[1] Malagasy Football Federation');
        expect(prompt).toContain('[2] Mexican Football Federation');
        expect(prompt).not.toContain('Football Association of Moldova');
        expect(prompt).toContain('Countries of the sites that published the news: Madagascar (1).');
        // what the AI decided is in the log, by name
        const logged = console.log.mock.calls.map(call => call[0]);
        expect(logged).toContain('Briefing: 1 names of 1 checked on their card, 1 left without their link: FMF (Football Association of Moldova)');
        expect(logged.some(line => line.endsWith('1 linked: FMF -> Malagasy Football Federation (not Football Association of Moldova)'))).toBe(true);
    });

    it('should leave the name with no link when the card points to nothing, and when what it searches fails', async () => {
        describeItems.mockImplementation(async (qids) => [MOLDOVAN].filter(item => qids.includes(item.qid)));
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        // no country, nothing spelled out: nothing searched, nothing to choose from
        const bare = {storyId: 1, titles: ['FMF elects its leaders'], sites: ['bbc.com'], text: ''};
        const [card] = await withNamesLinked(await withNamesChecked(fmf(), [bare]), [bare]);
        expect(card.names[0].qid).toBeNull();
        expect(exactItems).not.toHaveBeenCalled();
        expect(searchedItems).not.toHaveBeenCalled();
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        // Wikidata asks to wait, Wikipedia answers nothing: the name stays as the check left it
        describeItems.mockImplementation(async (qids) => [MOLDOVAN, MALAGASY].filter(item => qids.includes(item.qid)));
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        exactItems.mockRejectedValue(Object.assign(new Error('Wikidata asked to wait.'), {paused: true}));
        const [again] = await withNamesLinked(await withNamesChecked(fmf(), [malagasy]), [malagasy]);
        expect(again.names[0].qid).toBeNull();
    });

    it('should search again only for the names the check sent away, MAX_RELINK a briefing', async () => {
        describeItems.mockImplementation(async (qids) => [MOLDOVAN, MALAGASY].filter(item => qids.includes(item.qid)));
        const bare = {...malagasy, text: ''};
        const many = [{storyId: 1, names: Array.from({length: 13}, (_, i) => ({name: `FM${String.fromCharCode(65 + i)}`, id: 30 + i, qid: 'Q738074', kind: 'organization'})), places: []}];
        ollamaJson.mockResolvedValue({same: 'no'});
        searchedItems.mockResolvedValue(['Q900']);
        await withNamesLinked(await withNamesChecked(many, [bare]), [bare]);
        expect(searchedItems).toHaveBeenCalledTimes(10);
    });
});
