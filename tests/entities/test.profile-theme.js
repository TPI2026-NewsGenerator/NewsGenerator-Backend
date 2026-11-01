//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.profile-theme.js
//  Description: The theme of a profile, the words that come back in its interests, and the descriptions of
//               Wikidata that hold one: "football" for the profiles of football, nothing for a profile of
//               many subjects or for a country
//

import {jest} from '@jest/globals';
import {describe, expect, it} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {holdsTheme, themeOf} = await import('../../services/utils/profile-theme.js');

const interest = (text, keywords = '') => ({text, keywords});

describe('themeOf', () => {
    it('should keep the words that come back in the keywords of all the interests of a profile of football, the ones of most interests first', () => {
        const theme = themeOf([
            interest('Gouvernance du football : UEFA et ses 55 associations', 'UEFA governance, FIFA elections, football federation president, football governance crisis'),
            interest('Arbitrage : je travaille dans l’arbitrage à l’UEFA', 'football refereeing, VAR technology, IFAB Laws of the Game, football referee controversy, referee appointment, referee sanction, refereeing finance, refereeing sponsorship'),
        ]);
        expect(theme[0]).toBe('football');
        expect(theme).toEqual(expect.arrayContaining(['football', 'refereeing', 'referee']));
        // said once, and a word of the prose the keywords do not repeat
        expect(theme).not.toContain('technology');
        expect(theme).not.toContain('arbitrage');
        expect(theme).not.toContain('associations');
    });

    it('should keep a word that is in half of the interests, as football for a referee who writes refereeing and UEFA for the rest', () => {
        const theme = themeOf([
            interest('Refereeing', 'football refereeing, referee appointment, referee scandal, refereeing committee'),
            interest('Refereeing rules', 'IFAB Laws, referee training, VAR technology, refereeing development, European referees'),
            interest('Refereeing cooperation', 'referee exchange, joint referee training, foreign referee, European referee'),
            interest('Governance', 'UEFA governance, football association structure, football federation election, European football'),
        ]);
        expect(theme).toEqual(expect.arrayContaining(['refereeing', 'referee', 'football']));
        // European is in three of them, and says nothing of the subject
        expect(theme).not.toContain('european');
        expect(theme).not.toContain('training');
    });

    it('should keep a word that comes back in one of two interests, as the referee and refereeing of a profile of two', () => {
        const theme = themeOf([
            interest('Gouvernance', 'football governance, football federation, football election'),
            interest('Arbitrage', 'football refereeing, referee appointment, referee sanction, refereeing finance, referee scandal, refereeing sponsorship'),
        ]);
        expect(theme).toEqual(expect.arrayContaining(['football', 'referee', 'refereeing']));
    });

    it('should keep no word from a profile of many subjects, and no country or nationality come back by chance', () => {
        expect(themeOf([
            interest('Tennis', 'ATP Tour, Roland Garros, tennis, tennis suisse'),
            interest('Intelligence artificielle', 'LLM, generative AI, EU AI Act'),
            interest('Politique suisse', 'votations fédérales, Conseil fédéral, Parlement suisse, politique suisse'),
        ])).toEqual([]);
        // a country named in every interest is no theme
        expect(themeOf([
            interest('Football suisse', 'Super League, football suisse, Suisse'),
            interest('Hockey en Suisse', 'hockey suisse, Suisse, National League'),
        ])).not.toContain('suisse');
    });

    it('should read the text of an interest that has no keywords, fold accents and case, and give nothing for no interest', () => {
        expect(themeOf([interest('Arbitrage : les ARBITRES, arbitrage vidéo, arbitrage', ''), interest('Arbitrage des Mondiaux', null)])).toContain('arbitrage');
        expect(themeOf([])).toEqual([]);
        expect(themeOf(undefined)).toEqual([]);
        expect(themeOf([interest(null, null)])).toEqual([]);
    });
});

describe('holdsTheme', () => {
    const theme = ['football', 'refereeing'];

    it('should find the word of the theme a description holds, whatever the form of the word', () => {
        expect(holdsTheme(theme, 'Spanish football manager')).toBe('football');
        expect(holdsTheme(theme, 'English footballer')).toBe('football');
        expect(holdsTheme(theme, 'entraîneur espagnol de football')).toBe('football');
        expect(holdsTheme(theme, 'footballeur suisse')).toBe('football');
        expect(holdsTheme(['arbitrage'], 'arbitre de football')).toBe('arbitrage');
        expect(holdsTheme(['referee'], 'Italian association football referee (born 1963)')).toBe('referee');
        expect(holdsTheme(['referee'], 'refereeing official')).toBe('referee');
    });

    it('should not find a word in a description that is about something else, or in none', () => {
        expect(holdsTheme(theme, 'American actor')).toBeNull();
        expect(holdsTheme(theme, 'foot doctor')).toBeNull();
        expect(holdsTheme(['governance'], 'government minister')).toBeNull();
        expect(holdsTheme(theme, '')).toBeNull();
        expect(holdsTheme(theme, null)).toBeNull();
        expect(holdsTheme([], 'Spanish football manager')).toBeNull();
        expect(holdsTheme(undefined, 'Spanish football manager')).toBeNull();
    });
});
