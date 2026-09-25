//
//  Author: Fabian Rostello
//  Date: 24.09.2026
//  File: test.corroboration.js
//  Description: Tests for the count of the media telling a story and of the ones writing it themselves
//

import {agenciesOf, containment, corroborationOf, shingles} from '../../services/utils/corroboration.js'

const text = (word) => Array.from({length: 80}, (_, i) => `${word}${i}`).join(' ');
const wire = text('mot');
const other = text('autre');

describe('shingles and containment', () => {
    it('should find a text copied inside a longer one', () => {
        const copy = shingles(wire);
        const longer = shingles(`Introduction de la rédaction. ${wire} Et une conclusion ajoutée par le journal.`);
        expect(containment(copy, longer)).toBe(1);
        expect(containment(copy, shingles(other))).toBe(0);
    });

    it('should ignore the accents and the case', () => {
        expect(containment(shingles('Élection présidentielle à Paris ce dimanche soir pour le premier tour décisif'),
            shingles('election PRESIDENTIELLE a paris ce dimanche soir pour le premier tour decisif'))).toBe(1);
    });
});

describe('agenciesOf', () => {
    it('should find the agencies a text credits', () => {
        expect(agenciesOf('Par Le Temps avec AFP')).toEqual(['AFP']);
        expect(agenciesOf('LONDON (Reuters) - Shares rose', 'Keystone-ATS')).toEqual(['Reuters', 'ATS']);
    });

    it('should not take a word for an agency', () => {
        expect(agenciesOf('The apartment is on the map of the city, a dpaper')).toEqual([]);
    });
});

describe('corroborationOf', () => {
    it('should count one wire republished by three media as one text', () => {
        const result = corroborationOf([
            {medium: 'a.fr', text: `${wire} (AFP)`},
            {medium: 'b.fr', text: `Titre. ${wire}`},
            {medium: 'c.fr', text: wire},
        ]);
        expect(result).toEqual({media: 3, read: 3, independent: 1, agencies: ['AFP']});
    });

    it('should count the texts written apart, never more than the media read', () => {
        const result = corroborationOf([
            {medium: 'a.fr', text: wire},
            {medium: 'b.fr', text: other},
            {medium: 'b.fr', text: text('troisieme')},
            {medium: 'c.fr', text: null},           // paywall: counted as a medium, not as a text
        ]);
        expect(result).toEqual({media: 3, read: 2, independent: 2, agencies: []});
    });
});
