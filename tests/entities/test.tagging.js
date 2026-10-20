//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.tagging.js
//  Description: The names the tagger finds in the news: as they are compared, the batches two taggers
//               share, the item of Wikidata of a name, and the stories naming the rare names of a card
//

import {setImmediate} from 'node:timers';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const MentionModel = {
    untagged: jest.fn(), save: jest.fn(async () => 0), setLink: jest.fn(async () => 1),
    namesOfArticles: jest.fn(async () => []), storiesNaming: jest.fn(async () => []),
};
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel}));
const tagTexts = jest.fn();
jest.unstable_mockModule('../../services/utils/tagger.js', () => ({tagTexts, taggerDevice: jest.fn(), taggerUrls: () => []}));
jest.unstable_mockModule('../../services/feed-service.js', () => ({RETENTION_DAYS: 30}));

const {cleanMentions, mentionKey, rareNames} = await import('../../services/utils/mentions.js');
const {tagBatch, textOf, TAGGED_CHARS} = await import('../../services/tagging-service.js');
const {exactItems, readItem} = await import('../../services/utils/wikidata.js');
const {storiesOfSameNames} = await import('../../services/utils/affair-names.js');
const {anglesPrompt} = await import('../../services/utils/other-angles.js');

const answer = (body, status = 200, headers = {}) => ({ok: status < 400, status, json: async () => body, headers: new Headers(headers)});

beforeEach(() => {
    Object.values(MentionModel).forEach(mock => mock.mockClear());
    tagTexts.mockReset();
});

describe('mentionKey', () => {
    it('should compare names whatever their case, accents, quotes and possessive', () => {
        expect(mentionKey('Aleksander Čeferin')).toBe(mentionKey('aleksander ceferin'));
        expect(mentionKey('Wisła Kraków')).toBe('wisla krakow');
        expect(mentionKey('« UEFA’s »')).toBe('uefa');
        expect(mentionKey('Gianni  Infantino.')).toBe('gianni infantino');
    });

    it('should drop a leading article only when two words are left', () => {
        expect(mentionKey('La Fédération lettone de football')).toBe('federation lettone de football');
        expect(mentionKey('Los Angeles')).toBe('los angeles');
        expect(mentionKey('Le Mans')).toBe('le mans');
    });
});

describe('cleanMentions', () => {
    it('should keep each name once per kind, of the kinds asked, none without a letter nor a sentence', () => {
        const names = cleanMentions([
            {text: 'LFF', label: 'organization'}, {text: 'lff', label: 'organization'}, {text: 'LFF', label: 'location'},
            {text: '2026', label: 'organization'}, {text: 'Riga', label: 'date'}, {text: 'x'.repeat(130), label: 'person'},
            {text: '"Vadims Ļašenko"', label: 'person'},
        ]);
        expect(names).toEqual([
            {key: 'lff', kind: 'organization', name: 'LFF'},
            {key: 'lff', kind: 'location', name: 'LFF'},
            {key: 'vadims lasenko', kind: 'person', name: 'Vadims Ļašenko'},
        ]);
        expect(cleanMentions(null)).toEqual([]);
    });

    it('should also keep the acronyms inside a longer name, no roman figure', () => {
        const names = cleanMentions([{text: 'UEFA Nations League', label: 'organization'}, {text: 'FIFA-Präsident', label: 'person'},
            {text: 'LFF II lyga', label: 'organization'}, {text: 'UEFA', label: 'organization'}, {text: 'Gianni Infantino', label: 'person'}]);
        expect(names.map(name => `${name.kind} ${name.key}`)).toEqual([
            'organization uefa nations league', 'organization uefa', 'person fifa-prasident', 'organization fifa',
            'organization lff ii lyga', 'organization lff', 'person gianni infantino',
        ]);
    });
});

describe('rareNames', () => {
    it('should keep the people and bodies named by most of the card and few other news', () => {
        const rows = [
            {id: 1, kind: 'organization', inCard: 3, news: 401},       // the UEFA: every news of football
            {id: 2, kind: 'organization', inCard: 2, news: 40},        // the LFF
            {id: 3, kind: 'person', inCard: 2, news: 12},
            {id: 4, kind: 'location', inCard: 3, news: 30},            // Latvia: a country
            {id: 5, kind: 'person', inCard: 1, news: 1},               // only the card names it
            {id: 6, kind: 'person', inCard: 1, news: 5},
        ];
        expect(rareNames(rows, {rare: 400, max: 2}).map(row => row.id)).toEqual([3, 2]);
    });
});

describe('textOf', () => {
    it('should give the tagger the title and the start of the description, longer than what is embedded', () => {
        const text = textOf({title: 'LFF backs Infantino', description: `The  Latvian ${'x'.repeat(900)}`});
        expect(text.startsWith('LFF backs Infantino. The Latvian x')).toBe(true);
        expect(text).toHaveLength('LFF backs Infantino. '.length + TAGGED_CHARS);
        expect(textOf({title: 'Alone', description: null})).toBe('Alone');
    });
});

describe('tagBatch', () => {
    it('should tag the newest news once per text, and save the names of each', async () => {
        MentionModel.untagged.mockResolvedValueOnce([
            {id: 1, title: 'LFF backs Infantino', description: 'The Latvian federation', lang: 'en'},
            {id: 2, title: 'LFF backs Infantino', description: 'The Latvian federation', lang: null},
        ]);
        tagTexts.mockResolvedValueOnce([[{text: 'LFF', label: 'organization'}, {text: 'Infantino', label: 'person'}]]);
        expect(await tagBatch('http://server:8021', 'cpu')).toBe(2);

        expect(MentionModel.untagged.mock.calls[0][0]).toMatchObject({limit: 16, taken: []});
        expect(tagTexts).toHaveBeenCalledWith('http://server:8021', ['LFF backs Infantino. The Latvian federation']);
        const saved = MentionModel.save.mock.calls[0][0];
        expect(saved.map(news => [news.id, news.names.map(name => name.key)])).toEqual([[1, ['lff', 'infantino']], [2, ['lff', 'infantino']]]);
        expect(saved[0].lang).toBe('en');
    });

    it('should leave the news one tagger reads to the other, and give them back once done or failed', async () => {
        let release;
        tagTexts.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        MentionModel.untagged.mockResolvedValueOnce([{id: 7, title: 'A', description: ''}]).mockResolvedValueOnce([{id: 8, title: 'B', description: ''}]);
        tagTexts.mockRejectedValueOnce(new Error('down'));

        const first = tagBatch('http://gaming:8021', 'cuda');
        await new Promise(resolve => setImmediate(resolve));
        await expect(tagBatch('http://server:8021', 'cpu')).rejects.toThrow('down');
        expect(MentionModel.untagged.mock.calls[0][0]).toMatchObject({limit: 128});
        expect(MentionModel.untagged.mock.calls[1][0].taken).toEqual([7]);
        release([[]]);
        await first;

        MentionModel.untagged.mockResolvedValueOnce([]);
        expect(await tagBatch('http://server:8021', 'cpu')).toBe(0);
        expect(MentionModel.untagged.mock.calls[2][0].taken).toEqual([]);
    });
});

describe('readItem', () => {
    it('should say the links were not read when Wikidata did not give them, not that there are none', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(answer({entities: {Q35572: {labels: {en: {value: 'UEFA'}}, claims: {}}}}))
            .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const item = await readItem('Q35572', 'en');
        expect(item).toMatchObject({qid: 'Q35572', label: 'UEFA', links: null});
        fetch.mockRestore();
        error.mockRestore();
    });
});

describe('exactItems', () => {
    it('should keep an item whose label is the name when the text found is a longer name of it', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({search: [
            {id: 'Q9011300', label: 'Javier Tebas', match: {type: 'label', language: 'es', text: 'Javier Tebas Medrano'}},
            {id: 'Q3', label: 'Javier Tebas Medrano Foundation', match: {text: 'Javier Tebas Medrano Foundation'}},
        ]}));
        expect(await exactItems('Javier Tebas', 'es')).toEqual(['Q9011300']);
        fetch.mockRestore();
    });

    it('should keep the items called exactly so, no page of Wikimedia, then wait the time asked after a refusal', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(answer({search: [
            {id: 'Q630231', label: 'Latvian Football Federation', match: {text: 'Latvian Football Federation'}},
            {id: 'Q1', label: 'Latvian Football Federation Cup', match: {text: 'Latvian Football Federation Cup'}},
            {id: 'Q2', label: 'Latvian football federation', description: 'Wikimedia disambiguation page', match: {text: 'Latvian football federation'}},
        ]}));
        expect(await exactItems('Latvian Football Federation', 'en')).toEqual(['Q630231']);

        fetch.mockResolvedValueOnce(answer({}, 429, {'retry-after': '20'}));
        await expect(exactItems('UEFA', 'en')).rejects.toMatchObject({paused: true});
        await expect(exactItems('FIFA', 'en')).rejects.toMatchObject({paused: true});
        expect(fetch).toHaveBeenCalledTimes(2);
        fetch.mockRestore();
    });
});

describe('storiesOfSameNames', () => {
    it('should look for the stories naming the rare names of each card and of their items', async () => {
        MentionModel.namesOfArticles.mockResolvedValueOnce([
            {id: 2, name: 'LFF', kind: 'organization', qid: null, linkedAt: new Date(), inCard: 2, news: 40},
            {id: 3, name: 'Latvian Football Federation', kind: 'organization', qid: 'Q630231', linkedAt: new Date(), inCard: 1, news: 25},
            {id: 1, name: 'UEFA', kind: 'organization', qid: 'Q35572', linkedAt: new Date(), inCard: 2, news: 401},
        ]);
        MentionModel.storiesNaming.mockResolvedValueOnce([{id_story: 77, shared: 2}]);
        const since = new Date('2026-09-13');
        const found = await storiesOfSameNames([{storyId: 5, members: [{id: 10}, {id: 11}, {id: 10}]}],
            {feedUrls: ['f'], since, excluded: [6], perStory: 13});

        expect(MentionModel.namesOfArticles).toHaveBeenCalledWith([10, 11], 401);
        expect(MentionModel.storiesNaming).toHaveBeenCalledWith({storyId: 5, likeness: 0.45, mentionIds: [2, 3], qids: ['Q630231'],
            feedUrls: ['f'], since, excluded: [6, 5], limit: 13});
        expect(found.get(5)).toEqual([{id_story: 77, shared: 2}]);
    });

    it('should leave a card without names, or whose names failed, with none', async () => {
        MentionModel.namesOfArticles.mockRejectedValueOnce(new Error('timeout'));
        const found = await storiesOfSameNames([{storyId: 5, members: [{id: 10}]}, {storyId: 6, members: []}], {feedUrls: [], since: new Date(), excluded: [], perStory: 5});
        expect([...found]).toEqual([[5, []], [6, []]]);
        expect(MentionModel.storiesNaming).not.toHaveBeenCalled();
    });
});

describe('anglesPrompt', () => {
    it('should give the day of the card and of each news', () => {
        const prompt = anglesPrompt('LFF backs Čeferin', [{title: 'Latvia backs Infantino', at: new Date('2026-09-30T10:00:00Z')}, {title: 'No date'}],
            [], new Date('2026-10-12T18:00:00Z'));
        expect(prompt).toContain('A news card of 12 Oct: "LFF backs Čeferin"');
        expect(prompt).toMatch(/\[1\] \(30 Sept?\) Latvia backs Infantino/);
        expect(prompt).toContain('[2] No date');
    });
});
