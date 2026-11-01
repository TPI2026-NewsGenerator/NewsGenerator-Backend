//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.name-prefilter.js
//  Description: Which news may name one of many names: a first test in memory, so that 300 names are not
//               checked one by one on every news the tagger has not read
//

import {describe, expect, it} from '@jest/globals';
import {mayName} from '../../services/utils/name-prefilter.js';

const news = (title, description = '') => ({title, description});

describe('mayName', () => {
    const may = mayName(['Aleksander Čeferin', 'Paris Saint-Germain', 'LFF', 'U.E.F.A.']);

    it('should let a news pass that holds the longest word of a name, accents and case aside', () => {
        expect(may(news('Aleksander Ceferin re-elected'))).toBe(true);
        expect(may(news('La LFF soutient Infantino'))).toBe(true);
        expect(may(news('Le match', 'au Parc des princes, Paris Saint-Germain gagne'))).toBe(true);
        expect(may(news('SAINT-GERMAIN EN LAYE'))).toBe(true);
    });

    it('should stop a news that holds no word of any name', () => {
        expect(may(news('The weather in Lyon', 'Sunny with some clouds'))).toBe(false);
        expect(may(news('Alexander the Great'))).toBe(false);
    });

    it('should read the names of the scripts written without spaces as texts', () => {
        const chinese = mayName(['习近平']);
        expect(chinese(news('习近平会见美国总统'))).toBe(true);
        expect(chinese(news('今天的天气'))).toBe(false);
    });

    it('should stop every news when there is no name', () => {
        expect(mayName([])(news('Anything'))).toBe(false);
    });
});
