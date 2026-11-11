//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.tagger.js
//  Description: What is sent to the tagger and what comes back: Japanese cut at the changes of alphabet (it has no space), the cut taken
//               out of the names that come back, the answers that are no list refused
//

import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

const {BREAK, tagTexts, withoutBreaks, withScriptBreaks} = await import('../../services/utils/tagger.js');

let fetch;
beforeEach(() => {
    fetch = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => fetch.mockRestore());

const NBSP = String.fromCharCode(0xa0);
const answer = (entities, status = 200) => ({ok: status === 200, status, json: async () => ({entities})});

describe('withScriptBreaks', () => {
    it('should put a break between the runs of katakana, hiragana, han and Latin letters, and nowhere else', () => {
        expect(withScriptBreaks('PSV佐野航大が今季初アシスト')).toBe(['PSV', '佐野航大', 'が', '今季初', 'アシスト'].join(BREAK));
        // the middle dot and the prolonged sound mark are katakana: a foreign name stays whole
        expect(withScriptBreaks('ミゲル・ロハス')).toBe('ミゲル・ロハス');
        expect(withScriptBreaks('ラミン・ヤマルを2位')).toBe(['ラミン・ヤマル', 'を', '2', '位'].join(BREAK));
        // punctuation and spaces are no alphabet: the break is not doubled by them
        expect(withScriptBreaks('FW 上田綺世、先制')).toBe(`FW 上田綺世、先制`);
    });

    it('should leave every text with no kana nor han as it is: Hangul, Latin, Cyrillic, han alone', () => {
        for (const text of ['KFA는 구자욱이 말했다', 'Gianni Infantino said, in a 10-year deal', 'Джанни Инфантино', '蔡其昌揭台日交流賽意義', '']) {
            expect(withScriptBreaks(text)).toBe(text);
        }
    });

    it('should turn a no-break space of the news into a space, so that the breaks are only the ones put here', () => {
        expect(withScriptBreaks(`FIFA${NBSP}会長`)).toBe('FIFA 会長');
        expect(withoutBreaks(withScriptBreaks('PSV佐野航大が'))).toBe('PSV佐野航大が');
    });
});

describe('tagTexts', () => {
    it('should send Japanese cut at the changes of alphabet and give the names back as the news write them', async () => {
        fetch.mockResolvedValueOnce(answer([
            [{text: `FW${BREAK}大橋祐紀`, label: 'person', score: 0.9}, {text: 'PSV', label: 'organization', score: 0.8}],
            [{text: 'Gianni Infantino', label: 'person', score: 0.99}],
        ]));
        const found = await tagTexts('http://tagger:8021', ['FW大橋祐紀は先発', 'Gianni Infantino said']);
        const sent = JSON.parse(fetch.mock.calls[0][1].body).texts;
        expect(sent).toEqual([['FW', '大橋祐紀', 'は', '先発'].join(BREAK), 'Gianni Infantino said']);
        expect(found[0].map(entity => entity.text)).toEqual(['FW大橋祐紀', 'PSV']);
        expect(found[0][0]).toMatchObject({label: 'person', score: 0.9});
        expect(found[1][0].text).toBe('Gianni Infantino');
    });

    it('should refuse an answer that is no list of names for each text', async () => {
        fetch.mockResolvedValueOnce(answer([[]]));
        await expect(tagTexts('http://tagger:8021', ['a', 'b'])).rejects.toThrow('answered no list of names');
        fetch.mockResolvedValueOnce(answer([], 401));
        await expect(tagTexts('http://tagger:8021', ['a'])).rejects.toThrow('refused the token');
    });
});
