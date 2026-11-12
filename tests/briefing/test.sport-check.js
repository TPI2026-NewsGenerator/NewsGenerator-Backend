//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.sport-check.js
//  Description: A card about another sport than the reader's is left out (sport-check.js): what the AI is shown, which cards the code believes it on (the sport is
//               not one the profile follows AND the words quoted are in the card), and that nothing is left out on a doubt
//

import process from 'node:process';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
const {normalizeSports, otherSports, sportName, sportPrompt, viewOf, withoutOtherSport, wrongSportOf} = await import('../../services/utils/sport-check.js');
const {ORIGINAL_START, ORIGINAL_END} = await import('../../services/utils/original-marks.js');

const item = (storyId, title, changes = {}) => ({storyId, title, names: [], translation: `${title} is told in a first sentence.\n\nA second paragraph.`, ...changes});
const quiet = () => ({log: jest.fn(), error: jest.fn()});
const PROFILE = 'I work in UEFA refereeing and follow European football.';

beforeEach(() => ollamaJson.mockReset());
afterEach(() => { delete process.env.AI_SPORT_CHECK; });

describe('sportName', () => {
    it('should fold the writings of a sport and give null for no sport', () => {
        expect(sportName('Soccer')).toBe('football');
        expect(sportName('futsal')).toBe('football');
        expect(sportName('Basket-ball')).toBe('basketball');
        expect(sportName(' Tennis. ')).toBe('tennis');
        for (const none of ['none', 'None', '', null, undefined, 'unknown', 'no sport']) expect(sportName(none)).toBeNull();
    });
});

describe('viewOf', () => {
    it('should show the title the reader sees, the names and the first words of the text translated, without the marks of the original', () => {
        const view = viewOf(item(1, 'Titre', {titleTranslation: 'Title seen', names: [{name: 'FIFA'}, {name: 'UEFA'}], translation: `${ORIGINAL_START}ignored${ORIGINAL_END} Text of the card.`}));
        expect(view.title).toBe('Title seen');
        expect(view.names).toEqual(['FIFA', 'UEFA']);
        expect(view.text).toContain('Text of the card.');
    });
});

describe('sportPrompt', () => {
    it('should give the profile, the cards with their numbers and names, and ask for the sport and the words that show it', () => {
        const prompt = sportPrompt(PROFILE, [{title: 'A title', names: ['ABA'], text: 'Its text.'}]);
        expect(prompt).toContain(PROFILE);
        expect(prompt).toContain('[1] A title\n    names: ABA\n    Its text.');
        expect(prompt).toContain('readerSports');
        expect(prompt).toContain('"evidence"');
        expect(prompt).toContain('When in doubt, "none"');
    });
});

describe('normalizeSports', () => {
    it('should read the sports of the reader and of each card, the cards by place from 0, each once, the ones not asked dropped', () => {
        const answer = {readerSports: ['Football'], cards: [{id: 1, sport: 'basketball', evidence: 'x'}, {id: '[2]', sport: 'soccer'}, {id: 2, sport: 'tennis'}, {id: 9, sport: 'tennis'}, {id: 0, sport: 'tennis'}, null]};
        const read = normalizeSports(answer, 3);
        expect([...read.sports]).toEqual(['football']);
        expect([...read.cards]).toEqual([[0, {sport: 'basketball', evidence: 'x'}], [1, {sport: 'football', evidence: null}]]);
    });

    it('should give no sports for a reader of every sport, of none named or of an answer that is not read', () => {
        expect(normalizeSports({readerSports: ['all'], cards: []}, 1).sports).toBeNull();
        expect(normalizeSports({readerSports: ['football', 'any'], cards: []}, 1).sports).toBeNull();
        expect(normalizeSports({readerSports: [], cards: []}, 1).sports).toBeNull();
        expect(normalizeSports({readerSports: 'football'}, 1).sports).toBeNull();
        expect(normalizeSports(null, 1).sports).toBeNull();
    });
});

describe('otherSports', () => {
    const views = [
        {title: 'Hellenic Basketball Federation: payroll', names: ['Hellenic Basketball Federation'], text: 'The federation elections.'},
        {title: 'Referees of the cup', names: [], text: 'Football referees named.'},
        {title: 'Sport law', names: [], text: 'A law on sponsors.'},
    ];

    it('should keep the cards of a sport the profile does not follow, when the words quoted are in the card', () => {
        const found = otherSports({readerSports: ['football'], cards: [
            {id: 1, sport: 'basketball', evidence: 'Hellenic Basketball Federation'}, {id: 2, sport: 'football', evidence: null}, {id: 3, sport: 'none', evidence: null}]}, views);
        expect([...found]).toEqual([[0, {sport: 'basketball', evidence: 'Hellenic Basketball Federation'}]]);
    });

    it('should not believe an AI that quotes words the card does not hold, that quotes nothing or almost nothing', () => {
        for (const evidence of ['Euroleague champions', null, 'ba', '']) {
            expect(otherSports({readerSports: ['football'], cards: [{id: 1, sport: 'basketball', evidence}]}, views).size).toBe(0);
        }
    });

    it('should compare the words in any case, and leave out nothing for a reader of every sport or a card the reader added', () => {
        expect(otherSports({readerSports: ['football'], cards: [{id: 1, sport: 'basketball', evidence: 'hellenic BASKETBALL federation'}]}, views).size).toBe(1);
        expect(otherSports({readerSports: ['all'], cards: [{id: 1, sport: 'basketball', evidence: 'Hellenic Basketball Federation'}]}, views).size).toBe(0);
        expect(otherSports({readerSports: ['football'], cards: [{id: 1, sport: 'basketball', evidence: 'Hellenic Basketball Federation'}]}, views, {skip: new Set([0])}).size).toBe(0);
    });

    it('should not leave out a card of a sport the profile follows among several', () => {
        const found = otherSports({readerSports: ['football', 'basketball'], cards: [{id: 1, sport: 'basketball', evidence: 'Hellenic Basketball Federation'}]}, views);
        expect(found.size).toBe(0);
    });
});

describe('wrongSportOf', () => {
    const items = [item(10, 'Hellenic Basketball Federation: payroll', {names: [{name: 'Hellenic Basketball Federation'}]}), item(11, 'Referees of the cup'), item(12, 'Added by the reader', {imported: true})];
    const answer = {readerSports: ['football'], cards: [
        {id: 1, sport: 'basketball', evidence: 'Hellenic Basketball Federation'}, {id: 2, sport: 'football', evidence: null}, {id: 3, sport: 'basketball', evidence: 'Added by the reader'}]};

    it('should answer the cards of another sport with their story, their title and the words that show it, and log them', async () => {
        ollamaJson.mockResolvedValue(answer);
        const log = quiet();
        const wrong = await wrongSportOf(items, PROFILE, {log});
        expect(wrong).toEqual([{storyId: 10, title: 'Hellenic Basketball Federation: payroll', sport: 'basketball', evidence: 'Hellenic Basketball Federation'}]);
        expect(ollamaJson.mock.calls[0][0]).toContain(PROFILE);
        expect(ollamaJson.mock.calls[0][2]).toEqual(expect.objectContaining({think: true}));
        expect(log.log).toHaveBeenCalledWith(expect.stringContaining('the profile follows football, 3 cards read, 1 of another sport'));
    });

    it('should leave every card when the AI fails, answers nothing, or when it is switched off', async () => {
        const log = quiet();
        ollamaJson.mockRejectedValue(new Error('down'));
        expect(await wrongSportOf(items, PROFILE, {log})).toEqual([]);
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('down'));
        ollamaJson.mockResolvedValue({});
        expect(await wrongSportOf(items, PROFILE, {log: quiet()})).toEqual([]);
        process.env.AI_SPORT_CHECK = 'off';
        ollamaJson.mockClear();
        expect(await wrongSportOf(items, PROFILE, {log: quiet()})).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
        expect(await wrongSportOf([], PROFILE, {log: quiet()})).toEqual([]);
    });
});

describe('withoutOtherSport', () => {
    it('should drop the cards found, in the order of the others, and say why', () => {
        const items = [item(1, 'A'), item(2, 'B'), item(3, 'C')];
        const log = quiet();
        const kept = withoutOtherSport(items, [{storyId: 2, title: 'B', sport: 'basketball', evidence: 'Basketball Federation'}], {log});
        expect(kept.map(one => one.storyId)).toEqual([1, 3]);
        expect(log.log).toHaveBeenCalledWith(expect.stringContaining('is left out, it is about basketball ("Basketball Federation")'));
    });

    it('should give the same cards when none is found', () => {
        const items = [item(1, 'A')];
        expect(withoutOtherSport(items, [])).toBe(items);
    });
});
