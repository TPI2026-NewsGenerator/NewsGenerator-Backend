//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-attribution.js
//  Description: Tests for the code that says which association a passage is about (fifa-attribution.js): a name that says its country is
//               enough, a bare acronym or a generic word needs the country in the text and none of the other owners of the letters,
//               and what cannot be shown is left out. The cases are the traps of the measure of 10.11.2026 ("JFA" of Jordan read as
//               Japan, "FMF" of Moldova or Mexico, "NFF" of Norway or Nigeria, "Federcalcio" of Mauritania read as Italy)
//

import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {attribute, countriesIn} from '../../services/utils/fifa-attribution.js';

const FILE = JSON.parse(readFileSync(new URL('../../services/utils/fifa-members.json', import.meta.url), 'utf8'));
const member = (code) => [...FILE.members, ...FILE.confederations].find(item => item.fifa === code);
const ok = (code, matched, text) => attribute({member: member(code), matched, text}).ok;

describe('countriesIn', () => {
    it('should find a country by its name or its adjective, in several languages', () => {
        expect(countriesIn('The Jordan Football Association said')).toEqual(new Set(['JO']));
        expect(countriesIn('Il presidente della federazione giapponese')).toEqual(new Set(['JP']));
        expect(countriesIn('La Fédération allemande de football a critiqué')).toEqual(new Set(['DE']));
        expect(countriesIn('Mauritanian federation president')).toEqual(new Set(['MR']));
    });

    it('should tell the four nations of the United Kingdom apart, and give none of them for the United Kingdom', () => {
        expect(countriesIn('The Welsh association')).toEqual(new Set(['GB-WLS']));
        expect(countriesIn('English clubs and the Scottish league')).toEqual(new Set(['GB-ENG', 'GB-SCT']));
        expect(countriesIn('British press')).toEqual(new Set());
    });
});

describe('attribute', () => {
    it('should accept a name that says its country', () => {
        expect(ok('JPN', 'Japan Football Association', 'Japan Football Association vice-president resigns')).toBe(true);
        expect(ok('GER', 'federation allemande de football', 'Le président de la Fédération allemande de football a créé la surprise')).toBe(true);
        expect(ok('WAL', 'Football Association of Wales', 'FAW boss renews call for Infantino to step down')).toBe(true);
        expect(ok('ENG', 'English Football Association', 'the chair of the English Football Association')).toBe(true);
    });

    it('should not read the "JFA" of Jordan as the association of Japan', () => {
        const text = 'Prince Ali, president of the Jordan Football Association (JFA), says the election is pure politics';
        expect(attribute({member: member('JPN'), matched: 'JFA', text}).ok).toBe(false);
        expect(attribute({member: member('JOR'), matched: 'JFA', text}).ok).toBe(true);
    });

    it('should accept an acronym with its country in the text and refuse it with a rival owner there', () => {
        expect(ok('JPN', 'JFA', 'JFA honorary president Kozo Tashima, a Japanese football figure, announces his candidacy')).toBe(true);
        expect(ok('JPN', 'JFA', 'JFA of Japan and of Jordan met')).toBe(false);
    });

    it('should not read the "FMF" of Mexico as Moldova, nor the "NFF" of Nigeria as Norway', () => {
        expect(ok('MDA', 'FMF', 'Mexico: the FMF president says the federation backs Infantino')).toBe(false);
        expect(ok('MEX', 'FMF', 'Mexico: the FMF president says the federation backs Infantino')).toBe(true);
        expect(ok('NOR', 'NFF', 'Nigeria Football Federation (NFF) backs Infantino, says its president')).toBe(false);
    });

    it('should not read the "Federcalcio" of another country as the Italian one, and say nothing of a generic word alone', () => {
        expect(ok('ITA', 'federcalcio', 'Il presidente della Federcalcio mauritana celebra Infantino')).toBe(false);
        expect(ok('ITA', 'federcalcio', 'La stoccata a Infantino dalla Federcalcio francese')).toBe(false);
        expect(ok('ENG', 'the FA', 'The FA is among European leaders who still want him to resign')).toBe(false);
        expect(ok('ENG', 'the FA', 'The FA, the English association, is among European leaders')).toBe(true);
    });

    it('should accept an acronym that only one association writes, with no country in the text', () => {
        expect(ok('ITA', 'FIGC', 'La FIGC ha criticato Infantino')).toBe(true);
        expect(ok('GER', 'DFB', 'Der DFB fordert einen Neustart')).toBe(true);
    });

    it('should keep a confederation, and ask a word of its world for the acronyms that are also words or clubs', () => {
        expect(ok('UEFA', 'UEFA', 'UEFA president Ceferin criticised Infantino')).toBe(true);
        expect(ok('AFC', 'AFC', 'AFC Bournemouth beat Brighton, Infantino watched')).toBe(false);
        expect(ok('AFC', 'AFC', 'The Asian confederation AFC backs Infantino for a fourth term')).toBe(true);
        expect(ok('AFC', 'Asian Football Confederation', 'The Asian Football Confederation backs Infantino')).toBe(true);
    });
});
