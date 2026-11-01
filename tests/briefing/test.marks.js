//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.marks.js
//  Description: The terms a profile follows marked in the briefing the page shows: the places of the
//               ones it follows now, and the words of a description around a term its title does not name
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {excerptOf, withMarks} = await import('../../services/briefing-service.js');

describe('excerptOf', () => {
    it('should give the words of the description around the term, cut between two words', () => {
        const description = `${'Le match a commencé sous la pluie devant un public nombreux et bruyant, les deux équipes prudentes. '.repeat(2)}`
            + `Puis la VAR a annulé le but de la victoire à la dernière minute, au grand dam des supporters venus en nombre ce soir-là au stade. ${'Fin. '.repeat(30)}`;
        const excerpt = excerptOf('Un match nul sous la pluie', description, 'VAR');

        expect(excerpt).toMatch(/^…\S/);
        expect(excerpt).toMatch(/\S…$/);
        expect(excerpt).toContain('la VAR a annulé le but');
        expect(excerpt.length).toBeLessThan(230);
    });

    it('should give the description whether the title names the term or not', () => {
        expect(excerptOf('La VAR annule le but', 'La VAR a annulé le but de Lens à la 80e minute.', 'VAR')).toBe('La VAR a annulé le but de Lens à la 80e minute.');
        const long = `${'Le match a commencé sous la pluie devant un public nombreux. '.repeat(4)}Puis la VAR a annulé le but. ${'Fin. '.repeat(30)}`;
        const excerpt = excerptOf('La VAR annule le but', long, 'VAR');
        expect(excerpt).toContain('la VAR a annulé le but');
        expect(excerpt.length).toBeLessThan(230);
    });

    it('should give the beginning of the description when it does not name the term, cut between two words', () => {
        expect(excerptOf('Un match nul', 'Rien à signaler.', 'VAR')).toBe('Rien à signaler.');
        const description = 'Le match a commencé sous la pluie devant un public nombreux et bruyant, les deux équipes prudentes. '.repeat(5);
        const excerpt = excerptOf('Un match nul', description, 'VAR');
        expect(excerpt.startsWith('Le match a commencé')).toBe(true);
        expect(excerpt).toMatch(/\S…$/);
        expect(excerpt.length).toBeLessThanOrEqual(201);
        // a passage of the description as it is: what a translation of the line is checked against
        expect(description).toContain(excerpt.replace(/…$/, ''));
    });

    it('should give none without a description, or when it only repeats the title', () => {
        expect(excerptOf('Un match nul', null, 'VAR')).toBeNull();
        expect(excerptOf('Un match nul', '   ', 'VAR')).toBeNull();
        expect(excerptOf('La VAR annule le but', 'La VAR annule le but.', 'VAR')).toBeNull();
        expect(excerptOf('La VAR annule le but !', '  la var   annule le but', 'VAR')).toBeNull();
    });

    it('should keep a short description whole', () => {
        expect(excerptOf('Un match nul', 'La VAR a tout changé.', 'VAR')).toBe('La VAR a tout changé.');
    });
});

describe('withMarks', () => {
    const briefing = {
        id: 9, status: 'ready', items: [{
            storyId: 1, title: 'Infantino face à la VAR', titleTranslation: null, summary: 'La VAR a parlé.\n\nInfantino aussi.', translation: null,
            angles: [{title: 'Le Var sous la pluie', titleTranslation: 'La VAR au Nigeria'}],
            contested: [{sentence: 'Infantino dément.', translation: null}],
        }],
    };

    it('should give the places of the terms in each text the page shows, the texts without any left out', () => {
        const [item] = withMarks(briefing, ['VAR', 'Infantino']).items;

        expect(item.marks).toEqual({title: [[0, 9], [20, 23]], summary: [[3, 6], [17, 26]]});
        expect(item.angles[0].marks).toEqual({titleTranslation: [[3, 6]]});
        expect(item.contested[0].marks).toEqual({sentence: [[0, 9]]});
    });

    it('should say which terms a card names, in the order followed, and the ones only an other angle names', () => {
        const nigeria = {...briefing, items: [{...briefing.items[0], angles: [{title: 'Le Nigeria et Klaveness'}]}]};
        expect(withMarks(nigeria, ['Klaveness', 'VAR', 'Malagò', 'Infantino']).items[0].found).toEqual([
            {term: 'Klaveness', qid: null, angle: true}, {term: 'VAR', qid: null, angle: false}, {term: 'Infantino', qid: null, angle: false},
        ]);
        expect(withMarks(briefing, ['Malagò']).items[0].found).toEqual([]);
    });

    it('should mark an item followed by every name of it, and say it is found under its label', () => {
        const fifa = {label: 'FIFA', qid: 'Q253414', names: ['FIFA', 'Infantino']};
        const marked = withMarks(briefing, [fifa, 'VAR']);
        expect(marked.items[0].found).toEqual([{term: 'FIFA', qid: 'Q253414', angle: false}, {term: 'VAR', qid: null, angle: false}]);
        expect(marked.items[0].marks).toEqual(withMarks(briefing, ['FIFA', 'Infantino', 'VAR']).items[0].marks);
    });

    it('should leave a briefing as it is when the profile follows no term, or there is none', () => {
        expect(withMarks(briefing, [])).toBe(briefing);
        expect(withMarks(null, ['VAR'])).toBeNull();
    });
});
