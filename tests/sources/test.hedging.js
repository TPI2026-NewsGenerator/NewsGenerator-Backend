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

    // the user, 11.11.2026 (option A): the "alleged" of a crime report says the guilt is not proved, not that the news is not confirmed
    it('should not take the "alleged" of a crime report for a hedge', () => {
        expect(hedgedBy('Man arrested after allegedly stealing packages')).toBeNull();
        expect(hedgedBy('Capturan a presunto líder de una red de lavado')).toBeNull();
        expect(hedgedBy('Dos detenidos que presuntamente distribuían drogas')).toBeNull();
        expect(hedgedBy('Il presunto responsabile è ricercato')).toBeNull();
    });

    it('should find the hedges of the languages that had none', () => {
        expect(hedgedBy('Segundo fontes do clube, o jogador vai sair')).toBe('segundo fontes');
        expect(hedgedBy('De speler zou naar verluidt vertrekken')).toBe('naar verluidt');
        expect(hedgedBy('Σύμφωνα με πληροφορίες, η πτήση προσγειώθηκε')).toBe('σύμφωνα με πληροφορίες');
        expect(hedgedBy('Oyuncunun ayrılacağı iddia edildi')).toBe('iddia edildi');
        expect(hedgedBy('Wenger navodno razmišlja o kandidaturi')).toBe('navodno');
        expect(hedgedBy('Руководитель команды отреагировал на слухи о новом контракте')).toBe('слухи');
        expect(hedgedBy('계약이 체결된 것으로 전해졌다')).toBe('것으로 전해졌다');
    });

    it('should not take a rumour that the article denies or says is over for a hedge, and find it when it stands', () => {
        expect(hedgedBy('White House denies exit rumours after midterm losses')).toBeNull();
        expect(hedgedBy('Le PSG ferme la piste', 'Une rumeur démentie ce lundi.')).toBeNull();
        expect(hedgedBy('The wait is over', 'After months of speculation, he signed.')).toBeNull();
        expect(hedgedBy('Nach Gerüchten um Bayern: Trainer bestätigt Interesse')).toBeNull();
        expect(hedgedBy('Transfer rumors: Everton eye a loan')).toBe('rumor');
        expect(hedgedBy('Speculation ramps up over his return')).toBe('speculation');
    });

    it('should search a word as a word where it begins or ends another one', () => {
        expect(hedgedBy('Politikere frygter en milliardlussing')).toBeNull();
        expect(hedgedBy('Weber Baumaschinen und Fahrzeuge GmbH')).toBeNull();
        expect(hedgedBy('Pravděpodobnost, že FED zvýší sazby')).toBeNull();
        expect(hedgedBy('Il rumore del cantiere', 'I rumori della città')).toBeNull();
        expect(hedgedBy('Vor dem Treffen rumort es in der Partei')).toBeNull();
    });

    it('should give the word as the article wrote it, in lower case', () => {
        expect(hedgedBy('Mbappe REPORTEDLY Agreed Terms')).toBe('reportedly');
    });
});
