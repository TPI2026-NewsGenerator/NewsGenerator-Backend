//
//  Author: Fabian Rostello
//  Date: 23.09.2026
//  File: test.hedging.js
//  Description: Tests for the words a newspaper uses to say it has no confirmation
//

import {hedgedBy} from '../../services/utils/hedging.js'

describe('hedgedBy', () => {
    it('should find the words an article uses to hedge, in each language searched', () => {
        expect(hedgedBy('Mbappe reportedly agreed terms with Real Madrid')).toBe('reportedly');
        expect(hedgedBy('Le PSG croit savoir que le joueur veut partir')).toBe('croit savoir');
        expect(hedgedBy('Según fuentes cercanas al club, el fichaje está cerrado')).toBe('según fuentes');
        expect(hedgedBy('Berichten zufolge wechselt der Spieler im Sommer')).toBe('berichten zufolge');
        expect(hedgedBy('Secondo indiscrezioni il tecnico lascia la panchina')).toBe('secondo indiscrezioni');
    });

    it('should find nothing in a news stated plainly', () => {
        expect(hedgedBy('Columbus Crew sack coach after incident with female referee')).toBeNull();
        expect(hedgedBy('Real Madrid beat Villarreal 3-1 at the Bernabeu')).toBeNull();
    });

    it('should read the description as well as the title', () => {
        expect(hedgedBy('A quiet headline', 'The club, according to sources, is ready to sell')).toBe('according to sources');
    });

    it('should prefer the longest marker, not the first word inside it', () => {
        expect(hedgedBy('The move, according to sources close to the player, is done')).toBe('according to sources');
    });

    it('should answer nothing rather than fail on a news without text', () => {
        expect(hedgedBy(null, undefined)).toBeNull();
        expect(hedgedBy('')).toBeNull();
    });
});
