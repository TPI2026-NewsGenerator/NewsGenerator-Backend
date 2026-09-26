//
//  Author: Fabian Rostello
//  Date: 26.09.2026
//  File: test.resume.js
//  Description: Tests for the summaries of the briefing: written in the language of the reader
//               only, asked again once when words of another language stay in them
//

import {describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {newUsage, ollamaResume} = await import('../../services/utils/ollama.js');
const {strayWords} = await import('../../services/utils/language.js');

const answer = (summary) => ({message: {content: `TOPIC: technology\nSOURCING: named\n${summary}`}, prompt_eval_count: 10, eval_count: 5});
const MIXED = "L'Union européenne a adopté le Règlement sur l'intelligence artificielle, known as the EU AI Act.";
const FRENCH = "L'Union européenne a adopté l'EU AI Act, le règlement sur l'intelligence artificielle.";

describe('strayWords', () => {
    it('should find the English words left in a French summary, and the French ones in an English one', () => {
        expect(strayWords(MIXED, 'French')).toEqual(['known', 'the']);
        expect(strayWords('The minister said the law passed, dans le texte avec des amendements.', 'English')).toEqual(['dans', 'avec', 'des']);
    });

    it('should leave the names and the words other languages share', () => {
        expect(strayWords('Selon The Guardian, le ministre est parti.', 'French')).toEqual([]);
        expect(strayWords('Was die Regierung sagt, ist klar.', 'German')).toEqual([]);
        expect(strayWords('Les jugadores que dijo el entrenador.', 'Spanish')).toEqual([]);
    });
});

describe('ollamaResume', () => {
    it('should ask once when the summary is all in the language of the reader', async () => {
        chat.mockReset().mockResolvedValueOnce(answer(FRENCH));
        const usage = newUsage();
        const result = await ollamaResume('EU AI Act', 'The EU formally adopted...', {language: 'French', usage});
        expect(result).toEqual({summary: FRENCH, topic: 'technology', sourcing: 'named'});
        expect(usage.calls).toBe(1);
    });

    it('should ask again once, showing the words to translate, when another language stayed in it', async () => {
        chat.mockReset().mockResolvedValueOnce(answer(MIXED)).mockResolvedValueOnce(answer(FRENCH));
        const usage = newUsage();
        const result = await ollamaResume('EU AI Act', 'The EU formally adopted...', {language: 'French', usage});
        expect(result.summary).toBe(FRENCH);
        expect(usage.calls).toBe(2);
        const {messages} = chat.mock.calls[1][0];
        expect(messages.at(-1).content).toContain('known, the');
    });

    it('should keep the first summary when the second is no better', async () => {
        chat.mockReset().mockResolvedValueOnce(answer(MIXED)).mockResolvedValueOnce(answer(MIXED));
        const result = await ollamaResume('EU AI Act', 'The EU formally adopted...', {language: 'French'});
        expect(result.summary).toBe(MIXED);
        expect(chat).toHaveBeenCalledTimes(2);
    });
});
