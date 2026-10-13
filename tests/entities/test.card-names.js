//
//  Author: Fabian Rostello
//  Date: 13.10.2026
//  File: test.card-names.js
//  Description: The people and organisations a card shows, and the names of the cards suggested to follow
//

import {describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {cardNames, shortName, suggestedNames, writtenAsName} = await import('../../services/utils/card-names.js');

const row = (name, inCard, {kind = 'organization', qid = null, news = 3} = {}) => ({name, kind, qid, inCard, news});

describe('cardNames', () => {
    it('should show the names most of its articles name, once each, the longest writing with its item, never a place', () => {
        const names = cardNames([
            row('Infantino', 5, {kind: 'person'}),
            row('Gianni Infantino', 3, {kind: 'person', qid: 'Q124138'}),
            row('FIFA', 4),
            row('Zurich', 6, {kind: 'location'}),
            row('PSG', 2), row('Paris Saint-Germain', 2),
            row('LFF', 1),
        ], 8);
        expect(names).toEqual([
            {name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'},
            {name: 'FIFA', qid: null, kind: 'organization'},
            {name: 'Paris Saint-Germain', qid: null, kind: 'organization'},
        ]);
    });

    it('should show the writing of the item or the most met, never a compound nor a declined form for it', () => {
        const names = cardNames([
            row('FIFA', 6), row('FIFA-Präsidentschaftswahl', 2),
            row('Gianni Infantino', 5, {kind: 'person', qid: 'Q124138'}), row('Giannijem Infantinom', 2, {kind: 'person'}),
            row('UEFA', 4, {qid: 'Q35572'}), row('UEFA President', 2, {kind: 'person'}),
            row('La CAF', 3), row('Confederation of African Football', 2),
        ], 8, {max: 10});
        expect(names.map(name => name.name)).toEqual(['FIFA', 'Gianni Infantino', 'UEFA', 'La CAF', 'FIFA-Präsidentschaftswahl']);
    });

    it('should leave out the agencies, the medium itself, the slips of the tagger, and keep 4 at most', () => {
        const names = cardNames([
            row('Reuters', 4), row('AFP', 4), row('Le Temps', 4), row('TV', 4),
            row('Un entraîneur légendaire', 4, {kind: 'person'}),
            row('Cihan Aydın', 2, {kind: 'person', news: 2}),
            row('Kadir Sağlam', 1, {kind: 'person', news: 1}),
            row('UEFA', 3), row('VAR', 3), row('IFAB', 2), row('FIGC', 2),
        ], 4, {media: ['letemps.ch']});
        expect(names.map(name => name.name)).toEqual(['UEFA', 'VAR', 'Cihan Aydın', 'IFAB']);
    });

    it('should tell a name from a description the tagger took for one', () => {
        expect(['FIFA', 'La Liga', 'Le PSG', 'Federação Portuguesa de Futebol', 'Gianni Infantino'].map(writtenAsName)).toEqual([true, true, true, true, true]);
        expect(['promising officials', 'Un entraîneur légendaire', 'Italian federation', 'fédération portugaise', 'il'].map(writtenAsName))
            .toEqual([false, false, false, false, false]);
    });
});

describe('suggestedNames', () => {
    const uefa = {name: 'UEFA', qid: 'Q35572', kind: 'organization'};
    const lff = {name: 'LFF', qid: null, kind: 'organization'};
    const infantino = {name: 'Gianni Infantino', qid: 'Q124138', kind: 'person'};

    it('should suggest the names of two cards at least, the most met first, the ones followed left out', () => {
        const cards = [[uefa, lff], [uefa, infantino], [uefa, {name: 'Infantino', qid: null, kind: 'person'}], [lff]];
        expect(suggestedNames(cards, {qids: [], words: []})).toEqual([
            {...uefa, cards: 3},
            {...infantino, cards: 2},
            {...lff, cards: 2},
        ]);
        expect(suggestedNames(cards, {qids: ['Q35572'], words: ['infantino']})).toEqual([{...lff, cards: 2}]);
    });
});

describe('shortName', () => {
    it('should show a long label by its acronym, the one of its initials first, and a short label as it is', () => {
        expect(shortName('Union of European Football Associations', ['UEFA', 'Union of European Football Associations', 'ΟΥΕΦΑ'])).toBe('UEFA');
        expect(shortName('Fédération Internationale de Football Association', ['FIFA', 'IFA'])).toBe('FIFA');
        expect(shortName('Paris Saint-Germain FC', ['Paris Saint-Germain', 'PSG'])).toBe('PSG');
        expect(shortName('Roberto Rosetti', ['Rosetti'])).toBe('Roberto Rosetti');
        expect(shortName('Independent Football Regulator', ['Independent Football Regulator'])).toBe('Independent Football Regulator');
    });
});
