//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: test.neutral-titles.js
//  Description: The title of a card without the bait of its medium: the AI says which teaser to take out, the code
//               takes out only a whole sentence apart from the rest, never a fact, a name, a figure, a negation or
//               a quotation, and leaves the title as it was when too little would be left
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson}));
const {neutralTitle, neutralTitles, normalizeRemovals, neutralPrompt} = await import('../../services/utils/neutral-titles.js');

describe('neutralTitle', () => {
    it('should take out a teaser at the start of a title, with its punctuation', () => {
        expect(neutralTitle('Information incroyable ! Messi signe à Miami', ['Information incroyable !'])).toBe('Messi signe à Miami');
        expect(neutralTitle('Bomba zilei! L’Equipe: „Răzvan Burleanu poate fi candidatul UEFA!”', ['Bomba zilei!']))
            .toBe('L’Equipe: „Răzvan Burleanu poate fi candidatul UEFA!”');
        expect(neutralTitle('Choc : le président démissionne après le match', ['Choc :'])).toBe('Le président démissionne après le match');
    });

    it('should take out a teaser at the end, or between two sentences', () => {
        expect(neutralTitle('Le PSG gagne 3-0 à Lyon. Incroyable !', ['Incroyable !'])).toBe('Le PSG gagne 3-0 à Lyon.');
        expect(neutralTitle('Le PSG gagne à Lyon. Incroyable ! Le coach parle après le match', ['Incroyable !'])).toBe('Le PSG gagne à Lyon. Le coach parle après le match');
    });

    it('should not take a word out of a sentence, however loaded', () => {
        // « unbelievable » is inside the sentence: its removal leaves what the model's own words are
        expect(neutralTitle('Premier League explain unbelievable Chelsea VAR decision', ['unbelievable'])).toBe('Premier League explain unbelievable Chelsea VAR decision');
        expect(neutralTitle('Le PSG gagne un match incroyable 3-0', ['incroyable'])).toBe('Le PSG gagne un match incroyable 3-0');
    });

    it('should keep what says the fact: a name, an acronym, a figure, a negation, a status, a quotation', () => {
        expect(neutralTitle('¡Escándalo en el VAR! Denuncian presencia de personas ajenas', ['¡Escándalo en el VAR!']))
            .toBe('Escándalo en el VAR. Denuncian presencia de personas ajenas');
        expect(neutralTitle('Neue Regeln! SFV reagiert auf Fall Embolo', ['Neue Regeln!'])).toBe('Neue Regeln. SFV reagiert auf Fall Embolo');
        expect(neutralTitle('Messi did not sign for Miami. Not today', ['Not today'])).toBe('Messi did not sign for Miami. Not today');
        expect(neutralTitle('Choc: 3 morts dans l’incendie du stade', ['Choc: 3 morts'])).toBe('Choc: 3 morts dans l’incendie du stade');
        expect(neutralTitle('Messi says: "Incredible! I am staying at the club"', ['Incredible!'])).toBe('Messi says: "Incredible! I am staying at the club"');
    });

    it('should leave a title as it is when the passage is not in it, or too little would be left', () => {
        expect(neutralTitle('UEFA hit Zvezda’s pocket again', ['Incroyable !'])).toBe('UEFA hit Zvezda’s pocket again');
        expect(neutralTitle('Incroyable ! Il signe', ['Incroyable !'])).toBe('Incroyable ! Il signe');
        expect(neutralTitle('Wow ! Un but de légende marqué hier soir, voir la vidéo', ['Wow !', 'Un but de légende marqué hier soir,'])).toBe('Un but de légende marqué hier soir, voir la vidéo');
    });

    it('should take the exclamation mark of the tone out, not Yahoo! nor one before a closing quotation mark', () => {
        expect(neutralTitle('Federation in crisis!')).toBe('Federation in crisis');
        expect(neutralTitle('Nobody wants to lead the Federation! The assembly was postponed')).toBe('Nobody wants to lead the Federation. The assembly was postponed');
        expect(neutralTitle('Yahoo! Sports reports the sale of the club')).toBe('Yahoo! Sports reports the sale of the club');
        expect(neutralTitle('Burleanu: „Poate fi candidatul UEFA!”')).toBe('Burleanu: „Poate fi candidatul UEFA!”');
        expect(neutralTitle('¡Qué partido! ¡Qué final!')).toBe('Qué partido. Qué final');
    });

    it('should not touch a title that needs nothing', () => {
        expect(neutralTitle('— Interview exclusive du ministre sur la réforme')).toBe('— Interview exclusive du ministre sur la réforme');
        expect(neutralTitle('')).toBe('');
    });
});

describe('normalizeRemovals', () => {
    it('should read the passages of the titles given only, each title once', () => {
        const answer = {titles: [{n: 1, remove: ['A !']}, {n: '[2]', remove: []}, {n: 9, remove: ['x']}, {n: 1, remove: ['again']}, {n: 3, remove: 'no', extra: 1}, {n: 3, remove: [' B : ', 4]}]};
        expect([...normalizeRemovals(answer, 3)]).toEqual([[0, ['A !']], [2, ['B :']]]);
        expect(normalizeRemovals(null, 3).size).toBe(0);
    });
});

describe('neutralTitles', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should ask the AI once for all the titles and take out what it found', async () => {
        ollamaJson.mockResolvedValue({titles: [{n: 2, remove: ['Information incroyable !']}]});
        const titles = ['Le PSG gagne à Lyon', 'Information incroyable ! Messi signe à Miami'];
        expect(await neutralTitles(titles)).toEqual(['Le PSG gagne à Lyon', 'Messi signe à Miami']);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect(ollamaJson.mock.calls[0][0]).toBe(neutralPrompt(titles));
    });

    it('should leave the titles as they were when the AI fails, the exclamation marks aside', async () => {
        ollamaJson.mockRejectedValue(new Error('down'));
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        expect(await neutralTitles(['Information incroyable ! Messi signe!'])).toEqual(['Information incroyable. Messi signe']);
        error.mockRestore();
    });

    it('should ask for nothing when there is no title', async () => {
        expect(await neutralTitles([])).toEqual([]);
        expect(ollamaJson).not.toHaveBeenCalled();
    });
});
