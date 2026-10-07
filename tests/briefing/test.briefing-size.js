//
//  Author: Fabian Rostello
//  Date: 08.10.2026
//  File: test.briefing-size.js
//  Description: A briefing of 10, 20 or 30 cards: the stories the AI may choose, the share of each
//               interest, and the terms a profile follows
//

import {describe, expect, it} from '@jest/globals';
import {balanceSelection, BRIEFING_SIZES, chosenFor, normalizeSelection, selectionPrompt} from '../../services/utils/profile-ai.js';
import {cleanWatchTerms, MAX_WATCH_TERMS} from '../../services/utils/watch-terms.js';

const ids = (count, prefix) => Array.from({length: count}, (_, i) => ({id: `${prefix}${i + 1}`, why: ''}));

describe('the cards of a briefing', () => {
    it('should let the AI choose a reserve of at least 10 stories more, half the cards for the big ones', () => {
        expect(BRIEFING_SIZES.map(chosenFor)).toEqual([20, 30, 45]);
    });

    it('should keep at most the stories the AI may choose for the size asked', () => {
        const answer = {selected: ids(50, '').map(({id}) => ({id, why: 'x'}))};
        const known = answer.selected.map(item => item.id);
        expect(normalizeSelection(answer, known)).toHaveLength(20);
        expect(normalizeSelection(answer, known, 30)).toHaveLength(45);
    });

    it('should tell the AI how many stories to choose and the briefing keeps', () => {
        const prompt = selectionPrompt('Le tennis et la voile.', [{id: '1', title: 'Sinner', others: []}], undefined,
            ['Tennis', 'Voile'], false, 20);
        expect(prompt).toContain('Choisis au plus 30 histoires');
        expect(prompt).toContain('Son résumé en gardera 20');
    });

    it('should give each interest its share of the cards of the size asked', () => {
        // the AI chose 40 stories of A first, then 10 of B
        const chosen = [...ids(40, 'a'), ...ids(10, 'b')];
        const interestOf = (id) => id[0];
        const interests = [{id: 'a', weight: 1}, {id: 'b', weight: 1}];
        const kept = (size) => balanceSelection(chosen, interestOf, interests, size);

        expect(kept(10).filter(item => item.id[0] === 'b')).toHaveLength(5);
        expect(kept(20)).toHaveLength(20);
        expect(kept(20).filter(item => item.id[0] === 'b')).toHaveLength(10);
        expect(kept(30).filter(item => item.id[0] === 'b')).toHaveLength(10);
        expect(kept(30)).toHaveLength(30);
    });
});

describe('the terms a profile follows', () => {
    it('should keep each term once, as written, without quotes nor empty ones', () => {
        expect(cleanWatchTerms(['Infantino', ' infantino ', '"Lise  Klaveness"', '', '  ', 'VAR'])).toEqual(['Infantino', 'Lise Klaveness', 'VAR']);
    });

    it('should refuse a term of one letter, a sentence, or too many terms', () => {
        expect(() => cleanWatchTerms(['x'])).toThrow(expect.objectContaining({status: 400}));
        expect(() => cleanWatchTerms(['a'.repeat(61)])).toThrow(expect.objectContaining({status: 400}));
        expect(() => cleanWatchTerms(Array.from({length: MAX_WATCH_TERMS + 1}, (_, i) => `terme ${i}`))).toThrow(/At most/);
        expect(() => cleanWatchTerms('Infantino')).toThrow(expect.objectContaining({status: 400}));
    });
});
