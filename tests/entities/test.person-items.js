//
//  Author: Fabian Rostello
//  Date: 20.10.2026
//  File: test.person-items.js
//  Description: Whether a person is the one item of Wikidata called so: a human in a Wikipedia at least,
//               else when the AI finds the titles of their news fit it; never an item that is no human
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const describeItems = jest.fn();
const readCountries = jest.fn(async (qids) => new Map(qids.map(qid => [qid, {country: 'MX', international: false, bodies: []}])));
const ollamaJson = jest.fn();
const titlesNaming = jest.fn(async () => ['Uruguay fracasa en su innovación de las tarjetas virtuales']);
const exactItems = jest.fn();
const famousHuman = jest.fn();
const sitesNaming = jest.fn(async () => []);
const wikidata = await import('../../services/utils/wikidata.js');
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({...wikidata, describeItems, readCountries, exactItems, famousHuman}));
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../models/mention-model.js', () => ({MentionModel: {titlesNaming, sitesNaming}}));
const {WORD_SITELINKS, familyName, linkPerson, personItem} = await import('../../services/utils/person-items.js');

const VARELA = {qid: 'Q16238998', label: 'Eduardo Varela', description: 'Mexican journalist', links: 0, human: true};

beforeEach(() => {
    describeItems.mockReset();
    exactItems.mockReset();
    famousHuman.mockReset();
    ollamaJson.mockReset();
    titlesNaming.mockClear();
    readCountries.mockClear();
});

describe('personItem', () => {
    it('should keep a human in a Wikipedia at least without asking the AI', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q130394830', description: 'American football player', links: 1, human: true}]);
        expect(await personItem({id: 1, name: 'Keelon Russell'}, 'Q130394830')).toBe('Q130394830');
        expect(describeItems).toHaveBeenCalledWith(['Q130394830']);
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should never take an item that is no human: "one person", a song called Kim Jong Un', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q131541644', description: '2017 song by Lacrim', links: 0, human: false}])
            .mockResolvedValueOnce([]);
        expect(await personItem({id: 2, name: 'Kim Jong Un'}, 'Q131541644')).toBeNull();
        expect(await personItem({id: 3, name: 'one person'}, 'Q140403752')).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should keep the item of a word alone only when it is called so and well known, without asking the AI', async () => {
        const PEDRI = {qid: 'Q1', label: 'Pedri', description: 'Spanish association football player', links: 70, human: true};
        describeItems.mockResolvedValueOnce([PEDRI]);
        expect(await personItem({id: 5, name: 'Pedri'}, 'Q1')).toBe('Q1');
        // the name written without its accent or case is the label too
        describeItems.mockResolvedValueOnce([{...PEDRI, label: 'Cañizares'}]);
        expect(await personItem({id: 5, name: 'canizares'}, 'Q1')).toBe('Q1');
        // a family name alone: the item has the whole name, "Evenepoel" the painter, "Feijóo" a botanist
        describeItems.mockResolvedValueOnce([{qid: 'Q2', label: 'Henri Evenepoel', description: 'artist (1872-1899)', links: 13, human: true}]);
        expect(await personItem({id: 6, name: 'Evenepoel'}, 'Q2')).toBeNull();
        // called so, but in few Wikipedias: the card tells it
        describeItems.mockResolvedValueOnce([{...PEDRI, links: WORD_SITELINKS - 1}]);
        expect(await personItem({id: 5, name: 'Pedri'}, 'Q1')).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
        expect(titlesNaming).not.toHaveBeenCalled();
    });

    it('should ask the AI for an item in no Wikipedia, and keep it only when it says yes', async () => {
        describeItems.mockResolvedValue([VARELA]);
        ollamaJson.mockResolvedValueOnce({same: 'no'}).mockResolvedValueOnce({same: 'unsure'}).mockResolvedValueOnce({same: 'yes'});
        const row = {id: 4, name: 'Eduardo Varela', lang: 'es'};
        expect(await personItem(row, 'Q16238998')).toBeNull();
        expect(await personItem(row, 'Q16238998')).toBeNull();
        expect(await personItem(row, 'Q16238998')).toBe('Q16238998');
        expect(titlesNaming).toHaveBeenCalledWith(4, 5);
        const prompt = ollamaJson.mock.calls[0][0];
        expect(prompt).toContain('A person named in the news: "Eduardo Varela"');
        expect(prompt).toContain('- Uruguay fracasa en su innovación de las tarjetas virtuales');
        expect(prompt).toContain('The only item of Wikidata called so: Mexican journalist (country: MX), in 0 Wikipedias.');
    });

    it('should ask the AI for a family name after a particle, not for one known in 10 Wikipedias', async () => {
        describeItems.mockResolvedValueOnce([{qid: 'Q13363720', description: 'botanist (1928-2011)', links: 1, human: true}])
            .mockResolvedValueOnce([{qid: 'Q357984', description: 'Belgian association football player', links: 93, human: true}]);
        ollamaJson.mockResolvedValueOnce({same: 'no'});
        expect(await personItem({id: 5, name: 'De Roon'}, 'Q13363720')).toBeNull();
        expect(await personItem({id: 6, name: 'De Bruyne'}, 'Q357984')).toBe('Q357984');
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should take none without asking when no news title is left', async () => {
        describeItems.mockResolvedValueOnce([VARELA]);
        titlesNaming.mockResolvedValueOnce([]);
        expect(await personItem({id: 7, name: 'Eduardo Varela'}, 'Q16238998')).toBeNull();
        expect(ollamaJson).not.toHaveBeenCalled();
    });
});

describe('familyName', () => {
    it('should tell a family name after a particle from a full name', () => {
        expect(familyName('De Roon')).toBe(true);
        expect(familyName('van Bommel')).toBe(true);
        expect(familyName('Di Battista')).toBe(true);
        expect(familyName('Kevin De Bruyne')).toBe(false);
        expect(familyName('Eduardo Varela')).toBe(false);
        expect(familyName('Infantino')).toBe(false);
    });
});

describe('linkPerson', () => {
    const human = (qid, label, links) => ({qid, label, description: 'person', links, human: true});

    it('should link a Korean or Japanese name written with no space as a name in full: no word alone, whose item is labelled so in English', async () => {
        exactItems.mockResolvedValueOnce(['Q1']);
        describeItems.mockResolvedValueOnce([human('Q1', 'Son Heung-min', 80)]);
        expect(await linkPerson({id: 1, name: '손흥민', lang: 'ko'})).toEqual({qid: 'Q1', candidates: ['Q1']});
        expect(exactItems).toHaveBeenCalledWith('손흥민', 'ko');
        exactItems.mockResolvedValueOnce(['Q2']);
        describeItems.mockResolvedValueOnce([human('Q2', 'Shohei Ohtani', 90)]);
        expect((await linkPerson({id: 2, name: '大谷翔平', lang: 'ja'})).qid).toBe('Q2');
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should look for the name without the particle, the title or the position glued to it when the name as written is known to nobody', async () => {
        exactItems.mockResolvedValueOnce([]).mockResolvedValueOnce(['Q3']);
        describeItems.mockResolvedValueOnce([human('Q3', 'Koo Ja-wook', 12)]);
        expect(await linkPerson({id: 3, name: '구자욱이', lang: 'ko'})).toEqual({qid: 'Q3', candidates: ['Q3']});
        expect(exactItems.mock.calls).toEqual([['구자욱이', 'ko'], ['구자욱', 'ko']]);
        exactItems.mockReset();
        // han: Japanese then Chinese for each form, until one is known
        exactItems.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(['Q4']);
        describeItems.mockResolvedValueOnce([human('Q4', 'Yuki Ohashi', 6)]);
        expect((await linkPerson({id: 4, name: 'FW大橋祐紀', lang: 'ja'})).qid).toBe('Q4');
        expect(exactItems.mock.calls).toEqual([['FW大橋祐紀', 'ja'], ['FW大橋祐紀', 'zh'], ['大橋祐紀', 'ja']]);
    });

    it('should look for a name in the language of its letters, whatever the language kept with it: none, English, or the other of han alone', async () => {
        exactItems.mockResolvedValueOnce(['Q1']);
        describeItems.mockResolvedValueOnce([human('Q1', 'Son Heung-min', 80)]);
        expect((await linkPerson({id: 1, name: '손흥민', lang: null})).qid).toBe('Q1');
        expect(exactItems).toHaveBeenLastCalledWith('손흥민', 'ko');
        exactItems.mockResolvedValueOnce(['Q1']);
        describeItems.mockResolvedValueOnce([human('Q1', 'Son Heung-min', 80)]);
        await linkPerson({id: 1, name: '손흥민', lang: 'en'});
        expect(exactItems).toHaveBeenLastCalledWith('손흥민', 'ko');
        // han alone: Japanese first, then Chinese, until one knows it
        exactItems.mockReset();
        exactItems.mockResolvedValueOnce([]).mockResolvedValueOnce(['Q12']);
        describeItems.mockResolvedValueOnce([human('Q12', 'Chiang Wan-an', 40)]);
        expect((await linkPerson({id: 2, name: '蔣萬安', lang: null})).qid).toBe('Q12');
        expect(exactItems.mock.calls).toEqual([['蔣萬安', 'ja'], ['蔣萬安', 'zh']]);
        // other letters: the language of the news, English when it has none
        exactItems.mockReset();
        exactItems.mockResolvedValue([]);
        await linkPerson({id: 3, name: 'Gianni Infantino', lang: 'it'});
        await linkPerson({id: 4, name: 'Gianni Infantino', lang: null});
        expect(exactItems.mock.calls).toEqual([['Gianni Infantino', 'it'], ['Gianni Infantino', 'en']]);
    });

    it('should look for the forms in order, one after the other, and not for a form that is a word alone', async () => {
        // 박진만 감독이: nothing is known as written, nor without the particle: the name is the third form
        describeItems.mockResolvedValueOnce([human('Q5', 'Park Jin-man', 9)]);
        exactItems.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(['Q5']);
        expect((await linkPerson({id: 5, name: '박진만 감독이', lang: 'ko'})).qid).toBe('Q5');
        expect(exactItems.mock.calls.map(call => call[0])).toEqual(['박진만 감독이', '박진만 감독', '박진만']);
        // 채령이: the form 채령 is two syllables, a word alone: only the name as written is looked for
        exactItems.mockReset();
        exactItems.mockResolvedValueOnce([]);
        expect(await linkPerson({id: 6, name: '채령이', lang: 'ko'})).toEqual({qid: null, candidates: []});
        expect(exactItems).toHaveBeenCalledTimes(1);
    });

    it('should leave a foreign family name alone in hangul a word alone, as Trump is', async () => {
        exactItems.mockResolvedValueOnce(['Q6']);
        describeItems.mockResolvedValueOnce([human('Q6', 'Donald Trump', 300)]);
        expect(await linkPerson({id: 7, name: '트럼프', lang: 'ko'})).toEqual({qid: null, candidates: ['Q6']});
        // several humans called so: the famous one only for a name in full
        exactItems.mockResolvedValueOnce(['Q7', 'Q8']);
        expect(await linkPerson({id: 8, name: '디아즈', lang: 'ko'})).toEqual({qid: null, candidates: ['Q7', 'Q8']});
        expect(famousHuman).not.toHaveBeenCalled();
        exactItems.mockResolvedValueOnce(['Q9', 'Q10']);
        famousHuman.mockResolvedValueOnce('Q9');
        expect((await linkPerson({id: 9, name: '김민재', lang: 'ko'})).qid).toBe('Q9');
        expect(famousHuman).toHaveBeenCalledWith(['Q9', 'Q10'], expect.objectContaining({least: 10}));
    });

    it('should work as it did for a name with a space: the item, the famous one, none', async () => {
        exactItems.mockResolvedValueOnce(['Q11']);
        describeItems.mockResolvedValueOnce([human('Q11', 'Gianni Infantino', 70)]);
        expect((await linkPerson({id: 10, name: 'Gianni Infantino', lang: 'en'})).qid).toBe('Q11');
        exactItems.mockResolvedValueOnce([]);
        expect(await linkPerson({id: 11, name: 'Nobody Known', lang: 'en'})).toEqual({qid: null, candidates: []});
        expect(exactItems).toHaveBeenLastCalledWith('Nobody Known', 'en');
    });
});
