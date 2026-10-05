//
//  Author: Fabian Rostello
//  Date: 05.10.2026
//  File: test.contested.js
//  Description: Tests for "Contested": only sentences with a verb of denial go to the AI, only a
//               named denier of the card's news is shown, quoted as published
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {contestedOf, hasDenial} = await import('../../services/utils/contested.js');
const {newUsage} = await import('../../services/utils/ollama.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const page = (...sentences) => ({content: sentences.join(' '), blocks: [{kind: 'text', text: sentences.join(' ')}]});

beforeEach(() => chat.mockReset());

describe('hasDenial', () => {
    it('should find the verbs of a denial in five languages, accented ones too', () => {
        for (const sentence of [
            'Iran has denied any role in the incident.',
            'The club called the allegations baseless.',
            'Le Rassemblement national a démenti ces informations.',
            "L'entourage du ministre a nié les faits.",
            'Le Barça rejette toutes les accusations du Real.',
            'El club niega cualquier irregularidad.',
            'Der Verein weist die Vorwürfe entschieden zurück.',
            'La società smentisce le indiscrezioni.',
        ]) expect(hasDenial(sentence)).toBe(true);
    });

    it('should not take a word only containing one for a denial', () => {
        for (const sentence of [
            'Denmark won the match two to nil.',
            'The niece of the president spoke at the dinner.',
            'Le contexte politique reste tendu à Paris.',
            'They rejected the offer of the other club.',
        ]) expect(hasDenial(sentence)).toBe(false);
    });

    it('should read the words of the language of the article only, when it is known', () => {
        const lula = 'Ha ironizado señalando que "al pueblo le gusta" que dispute segundas vueltas.';
        expect(hasDenial(lula, 'es')).toBe(false);
        expect(hasDenial('The club will dispute the charges.', 'en')).toBe(true);
        expect(hasDenial('Le club nie les faits.', 'fr')).toBe(true);
    });
});

describe('contestedOf', () => {
    const texts = [
        {source: 'reuters.com', url: 'https://reuters.com/a', publishedAt: '2026-10-04T10:00:00.000Z', page: page(
            'A drone flew over the air base of RAF Fairford on Saturday night.',
            'Iran has denied any role in the incident and called the accusations baseless.',
            'Police did not deny that an arrest was made later in the night.')},
        {source: 'lemonde.fr', url: 'https://lemonde.fr/b', publishedAt: '2026-10-04T11:00:00.000Z', page: page(
            'Un drone a survolé la base aérienne de RAF Fairford samedi soir.',
            'Téhéran a démenti toute implication dans cet incident.')},
    ];

    it('should not ask the AI when no sentence has a verb of denial', async () => {
        expect(await contestedOf('A drone over RAF Fairford', [{...texts[0], page: page('A drone flew over the base on Saturday night.')}])).toEqual([]);
        expect(chat).not.toHaveBeenCalled();
    });

    it('should show a named denier of the news once, word for word, and leave out a side point or no denial', async () => {
        chat.mockResolvedValueOnce(json({sentences: [
            {n: 1, denied_by: 'Iran', self: true, about: 'main', denial: true},
            {n: 2, denial: false, denied_by: '', about: 'main'},
            {n: 3, denied_by: 'iran', self: true, about: 'main', denial: true},
        ]}));
        const usage = newUsage();
        const contested = await contestedOf('A drone over RAF Fairford', texts, {language: 'en', usage});

        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('[1] (reuters.com) Iran has denied any role');
        expect(prompt).toContain('[3] (lemonde.fr) Téhéran a démenti');
        expect(prompt).not.toContain('A drone flew over');
        expect(contested).toEqual([{
            by: 'Iran', sentence: 'Iran has denied any role in the incident and called the accusations baseless.',
            source: 'reuters.com', url: 'https://reuters.com/a', publishedAt: '2026-10-04T10:00:00.000Z',
            language: 'en', translation: null,
        }]);
        expect(usage.calls).toBe(1);
    });

    it('should translate a quote written in another language than the reader’s', async () => {
        chat.mockResolvedValueOnce(json({sentences: [{n: 3, denied_by: 'Tehran', self: true, about: 'main', denial: true}]}))
            .mockResolvedValueOnce(json({translations: ['Tehran denied any involvement in this incident.']}));
        const [denial] = await contestedOf('A drone over RAF Fairford', texts, {language: 'en'});
        expect(denial).toMatchObject({by: 'Tehran', sentence: 'Téhéran a démenti toute implication dans cet incident.',
            language: 'fr', translation: 'Tehran denied any involvement in this incident.'});
    });

    it('should show nothing for a denial of a side point, or someone contesting what another says', async () => {
        chat.mockResolvedValueOnce(json({sentences: [{n: 1, denied_by: 'Iran', self: true, about: 'side', denial: true}]}))
            .mockResolvedValueOnce(json({sentences: [{n: 1, denied_by: 'Iran', self: false, about: 'main', denial: true}]}));
        expect(await contestedOf('A drone over RAF Fairford', texts)).toEqual([]);
        expect(await contestedOf('A drone over RAF Fairford', texts)).toEqual([]);
    });
});
