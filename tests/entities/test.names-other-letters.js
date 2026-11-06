//
//  Author: Fabian Rostello
//  Date: 07.11.2026
//  File: test.names-other-letters.js
//  Description: A person written in Greek or Cyrillic letters, as the press writes the name and Wikidata does not, is the person linked whose
//               family name has the Latin spellings of its own (the briefing 444 of 6.11.2026: "Τζιάνι Ινφαντίνο" had no item, the card
//               no person, no country)
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {romanKeys, withSurnamesLinked} = await import('../../services/utils/card-names.js');
const {collapsed, romanizations, sameGivenName} = await import('../../services/utils/romanize.js');

describe('romanizations', () => {
    it('should give the Latin spellings of a name in Greek or Cyrillic letters, a letter two spellings share giving each of them', () => {
        expect(romanizations('Ινφαντίνο')).toEqual(['infantino', 'infadino']);
        expect(romanizations('Ρονάλντο')).toContain('ronaldo');
        expect(romanizations('Τζιάνι Ινφαντίνο')).toEqual(expect.arrayContaining(['tziani infantino', 'jiani infantino']));
        expect(romanizations('Γκερντ Μύλερ')).toContain('gerd muler');
        expect(romanizations('Килиан Мбаппе')).toEqual(['kilian mbappe']);
        expect(romanizations('Джанни Инфантино')).toContain('janni infantino');
    });

    it('should give none for a name in Latin letters, in another script, or with the letters of two others', () => {
        expect(romanizations('Gianni Infantino')).toEqual([]);
        expect(romanizations('إنفانتينو')).toEqual([]);
        expect(romanizations('インファンティーノ')).toEqual([]);
        expect(romanizations('Ινφαντίνο 日本')).toEqual([]);
        expect(romanizations('')).toEqual([]);
    });

    it('should tell given names that are one written with other letters from the ones that are not', () => {
        expect(sameGivenName('jiani', 'gianni')).toBe(true);
        expect(sameGivenName('gkerd', 'gerd')).toBe(true);
        expect(sameGivenName('lionel', 'lionel')).toBe(true);
        expect(sameGivenName('kristiano', 'c')).toBe(false);
        expect(sameGivenName('kris', 'k')).toBe(true);
        expect(sameGivenName('thomas', 'gerd')).toBe(false);
        expect(sameGivenName('ivan', 'kirill')).toBe(false);
        expect(collapsed('messi')).toBe('mesi');
    });
});

describe('withSurnamesLinked, a name in other letters', () => {
    // what MentionModel.personsByLooseSurname answers for the family names of the spellings (briefings of 6.11.2026)
    const loose = [
        {word: 'infantino', qid: 'Q124138', seen: 4974, keys: ['gianni infantino', 'canni infantino', 'president infantino']},
        {word: 'mesi', qid: 'Q615', seen: 9953, keys: ['lionel messi', 'leo messi']},
        {word: 'mesi', qid: 'Q41500870', seen: 23, keys: ['jorge messi']},
        {word: 'muler', qid: 'Q1', seen: 900, keys: ['thomas muller', 't muller']},
        {word: 'muler', qid: 'Q2', seen: 400, keys: ['gerd muller']},
        {word: 'petrov', qid: 'Q3', seen: 60, keys: ['kirill petrov']},
        {word: 'petrov', qid: 'Q4', seen: 50, keys: ['ivan petrov']},
        {word: 'sanchez', qid: 'Q5', seen: 2, keys: ['pedro sanchez']},
    ];
    const link = (name, rows = []) => withSurnamesLinked([[name]], rows, loose)[0];

    it('should link a Greek name in full to the person linked whose family name it spells, the card now has its person', () => {
        expect(link({name: 'Τζιάνι Ινφαντίνο', qid: null, kind: 'person'})).toEqual([
            {name: 'Τζιάνι Ινφαντίνο', qid: 'Q124138', kind: 'person', bySurname: 4974},
        ]);
    });

    it('should link a family name alone in Greek or Cyrillic letters, and a Cyrillic name, and a name that doubles a letter in Latin', () => {
        expect(link({name: 'Ινφαντίνο', qid: null, kind: 'person'})[0].qid).toBe('Q124138');
        expect(link({name: 'Лионель Месси', qid: null, kind: 'person'})[0].qid).toBe('Q615');
        expect(link({name: 'Μέσι', qid: null, kind: 'person'})[0].qid).toBe('Q615');
    });

    it('should take the person whose given name it is among several of one family name, whichever is the most met', () => {
        // Gerd Müller is met half as often as Thomas: its given name is the one written
        expect(link({name: 'Γκερντ Μύλερ', qid: null, kind: 'person'})[0].qid).toBe('Q2');
        expect(link({name: 'Τόμας Μύλερ', qid: null, kind: 'person'})[0].qid).toBe('Q1');
    });

    it('should leave a name no person fits: a given name that is none of theirs, persons about as met, a person met little', () => {
        // an Aleksandr Petrov is neither Kirill nor Ivan
        expect(link({name: 'Александр Петров', qid: null, kind: 'person'})[0].qid).toBeNull();
        // a family name alone with two persons about as met is none of them
        expect(link({name: 'Петров', qid: null, kind: 'person'})[0].qid).toBeNull();
        // a person met twice is no certainty
        expect(link({name: 'Санчез', qid: null, kind: 'person'})[0].qid).toBeNull();
        // nobody linked with this family name
        expect(link({name: 'Иван Иванов', qid: null, kind: 'person'})[0].qid).toBeNull();
    });

    it('should link only a person: the tagger takes a name in other letters for an organisation or has it linked already', () => {
        expect(link({name: 'Ινφαντίνο', qid: null, kind: 'organization'})[0].qid).toBeNull();
        expect(link({name: 'Τζιάνι Ινφαντίνο', qid: 'Q9', kind: 'person'})[0].qid).toBe('Q9');
        expect(romanKeys({name: 'Gianni Infantino', qid: null, kind: 'person'})).toEqual([]);
    });

    it('should keep one entry for a person a card names twice, and leave a name in Latin letters to the rule it had', () => {
        const names = [[{name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'}, {name: 'Ινφαντίνο', qid: null, kind: 'person'}]];
        expect(withSurnamesLinked(names, [], loose)[0]).toEqual([{name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'}]);
        const latin = [[{name: 'Infantino', qid: null, kind: 'person'}]];
        const rows = [{word: 'infantino', qid: 'Q124138', seen: 4974, asPerson: 1194, asOther: 329}];
        expect(withSurnamesLinked(latin, rows, loose)[0][0].qid).toBe('Q124138');
    });
});
