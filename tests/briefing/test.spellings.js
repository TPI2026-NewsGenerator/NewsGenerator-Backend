//
//  Author: Fabian Rostello
//  Date: 02.11.2026
//  File: test.spellings.js
//  Description: Tests for the spelling of the names of a card once translated: the names its text writes,
//               and a word of a title a consonant off one of them put back as the text spells it
//               (briefings 252 and 253 of 27.10.2026: "Frapar" in a title, "Stéphanie Frappart" in its text)
//

import {describe, expect, it} from '@jest/globals';
import {alignNames, namesIn, spellingNote, spellingsOf} from '../../services/utils/spellings.js';

const TEXT = `This past weekend, Thessaloniki hosted female officials of all categories.

In the seminar, the person responsible for women's refereeing at UEFA, Stéphanie Frappart, played a central role.

The opening speech was given by the president of the Central Refereeing Committee, Stéphane Lannoy, who focused on technical issues.`;

describe('namesIn', () => {
    it('should give the names a text writes, a first name and a family name as one, not the word that opens a sentence', () => {
        const names = namesIn(TEXT);
        expect(names).toEqual(expect.arrayContaining(['Thessaloniki', 'UEFA', 'Stéphanie Frappart', 'Stéphane Lannoy', 'Central Refereeing Committee']));
        expect(names).not.toContain('This');
        expect(names).not.toContain('The');
    });

    it('should never take the word that opens a sentence for part of a name, and give the most met first', () => {
        const names = namesIn('Stéphanie Frappart said so. Later Frappart left. Frappart came back, with Lannoy and Stéphanie Frappart.');
        expect(names[0]).toBe('Frappart');
        expect(names).toHaveLength(3);
        expect(names).toEqual(expect.arrayContaining(['Lannoy', 'Stéphanie Frappart']));
    });

    it('should leave the words of another alphabet out, a sentence a translation could not translate', () => {
        expect(namesIn('He spoke. Στεφανί Φραπάρ είπε ότι Frappart is here.')).toEqual(['Frappart']);
    });
});

describe('alignNames', () => {
    const names = namesIn(TEXT);

    it('should put a name written with a dropped consonant as the text of the card spells it', () => {
        expect(alignNames("Thessaloniki: Women's refereeing seminar with UEFA's Frapar", names, 'Θεσσαλονίκη: ... με τη Φραπάρ της UEFA'))
            .toBe("Thessaloniki: Women's refereeing seminar with UEFA's Frappart");
        expect(alignNames("UEFA referee Frapar's seminar", names)).toBe("UEFA referee Frappart's seminar");
    });

    it('should put a name written with other accents as Wikidata spells it, whatever the original writes (Lekjaâ, 6.11.2026)', () => {
        expect(alignNames('FRMF president Fouzi Lekjaâ must leave a position at the CAF.', ['Fouzi Lekjaa', 'CAF'], 'Le président de la FRMF Fouzi Lekjaâ doit quitter un poste'))
            .toBe('FRMF president Fouzi Lekjaa must leave a position at the CAF.');
        expect(alignNames("Lekjaâ's decision", ['Fouzi Lekjaa'])).toBe("Lekjaa's decision");
        // the accents Wikidata has are put back too, a name in capitals is left as it is
        expect(alignNames('Luka Modric scores', ['Luka Modrić'])).toBe('Luka Modrić scores');
        expect(alignNames('LEKJAÂ SPEAKS', ['Fouzi Lekjaa'])).toBe('LEKJAÂ SPEAKS');
    });

    it('should take the label of Wikidata, first in the names, over the same name another way written in the text', () => {
        expect(alignNames('Lekjaâ speaks', ['Fouzi Lekjaa', 'Fouzi Lekjaâ'])).toBe('Lekjaa speaks');
    });

    it('should put back a doubled consonant the other way', () => {
        expect(alignNames('Emil Bozhinovski referees', ['Emil Bozinovski'])).toBe('Emil Bozinovski referees');
    });

    it('should leave a word the card already spells, or the original writes as it is, alone', () => {
        expect(alignNames('Frappart leads the seminar', names)).toBe('Frappart leads the seminar');
        expect(alignNames('Frapar leads the seminar', names, 'Frapar leads the seminar')).toBe('Frapar leads the seminar');
    });

    it('should not change a first name to another: a vowel is another person', () => {
        expect(alignNames('Stéphane Lannoy', ['Stéphanie Lannoy'])).toBe('Stéphane Lannoy');
    });

    it('should not change a word that is another word, a word cut short, or a short one', () => {
        expect(alignNames('Greece hosted it', ['Greek'])).toBe('Greece hosted it');
        expect(alignNames('Meraviglia plays', ['Meravigli'])).toBe('Meraviglia plays');
        expect(alignNames('Iran leads', ['Iraq'])).toBe('Iran leads');
        expect(alignNames('A text', ['Thessaloniki'])).toBe('A text');
    });

    it('should not choose when two names fit', () => {
        expect(alignNames('Frapar leads', ['Frappar', 'Frapparr'])).toBe('Frapar leads');
    });

    it('should do nothing without names or text', () => {
        expect(alignNames('Frapar leads', [])).toBe('Frapar leads');
        expect(alignNames('', ['Frappart'])).toBe('');
        expect(alignNames(null, ['Frappart'])).toBeNull();
    });
});

describe('spellingNote', () => {
    it('should say how Wikidata spells the names of the news, and the names the card already spells', () => {
        const note = spellingNote({glossary: [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}], names: ['Stéphane Lannoy']});
        expect(note).toContain('“Φραπάρ” is Stéphanie Frappart');
        expect(note).toContain('already spells Stéphane Lannoy');
    });

    it('should say nothing when there is nothing to say', () => {
        expect(spellingNote()).toBe('');
        expect(spellingNote({glossary: [], names: []})).toBe('');
    });

    it('should give every spelling of a card to align a translation with', () => {
        expect(spellingsOf({glossary: [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}], names: ['Thessaloniki']}))
            .toEqual(['Thessaloniki', 'Stéphanie Frappart']);
    });
});
