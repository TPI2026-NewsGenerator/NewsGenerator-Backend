//
//  Author: Fabian Rostello
//  Date: 14.10.2026
//  File: test.statements.js
//  Description: Tests for the statements of a card's parties its articles report: only the sentences
//               with the words of a statement are read, a sentence kept only when both answers of the AI
//               read it as the party's own statement of the card's news, one per party
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {confirmingOf, hasStatement, statementsOf} = await import('../../services/utils/statements.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const page = (...sentences) => ({content: sentences.join(' '), blocks: sentences.map(text => ({kind: 'text', text}))});

beforeEach(() => chat.mockReset());

describe('hasStatement', () => {
    it('should find the words of a reported statement in several languages', () => {
        for (const sentence of [
            'In a statement, the FPF said a provisional suspension was issued on 9 October.',
            "L'UEFA a communiqué la sanction après les incidents racistes.",
            'Tal y como ha comunicado la UEFA a las asociaciones miembro, el plazo concluye el 22 de enero.',
            "L'AIA ha comunicato la designazione arbitrale per la partita.",
            'Em comunicado, o líder do setor destacou os contributos de todos.',
            'Uefa has confirmed on its website that an inspector was appointed.',
        ]) expect(hasStatement(sentence)).toBe(true);
    });

    it('should not read a sentence without them', () => {
        expect(hasStatement('Real Madrid beat Villarreal 1-0 on Saturday night.')).toBe(false);
    });
});

describe('confirmingOf', () => {
    const candidates = ['FPF statement', 'Expert opinion', 'FPF again'].map(sentence => ({sentence}));
    const yes = (n, by = 'FPF') => ({n, said_by: by, own: true, confirms: true});

    it('should keep a sentence both answers confirm, the second of the reversed order, once per party', () => {
        const first = {sentences: [yes(1), {n: 2, said_by: 'Eric Krakauer', own: true, confirms: true}, yes(3)]};
        const second = {sentences: [yes(1), {n: 2, said_by: 'Eric Krakauer', own: false, confirms: true}, yes(3)]};
        expect(confirmingOf(first, second, candidates)).toEqual([{sentence: 'FPF statement', by: 'FPF'}]);
    });

    it('should keep nothing of an answer of another shape or without a name', () => {
        expect(confirmingOf({sentences: [yes(1, '')]}, {sentences: [yes(3, '')]}, candidates)).toEqual([]);
        expect(confirmingOf(null, {cards: []}, candidates)).toEqual([]);
    });
});

describe('statementsOf', () => {
    const card = {title: 'Cristiano Ronaldo suspended by the Portuguese federation'};
    const texts = [{source: 'bbc.co.uk', url: 'https://bbc.co.uk/1', publishedAt: null,
        page: page('In a statement, the FPF said a provisional suspension was issued.', 'Ronaldo left the camp last week.')}];

    it('should ask twice with the sentences of a statement only, the parties named', async () => {
        chat.mockResolvedValue(json({sentences: [{n: 1, said_by: 'FPF', own: true, confirms: true}]}));
        const found = await statementsOf(card, texts, ['Portuguese Football Federation', 'Cristiano Ronaldo']);

        expect(chat).toHaveBeenCalledTimes(2);
        const prompt = chat.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('The ones it is about: Portuguese Football Federation, Cristiano Ronaldo.');
        expect(prompt).toContain('[1] (bbc.co.uk) In a statement, the FPF said');
        expect(prompt).not.toContain('left the camp');
        expect(found).toEqual([expect.objectContaining({by: 'FPF', source: 'bbc.co.uk', url: 'https://bbc.co.uk/1',
            sentence: 'In a statement, the FPF said a provisional suspension was issued.'})]);
    });

    it('should not ask the AI for a card without party or without such a sentence', async () => {
        expect(await statementsOf(card, texts, [])).toEqual([]);
        expect(await statementsOf(card, [{...texts[0], page: page('Ronaldo left the camp last week.')}], ['FPF'])).toEqual([]);
        expect(chat).not.toHaveBeenCalled();
    });
});
