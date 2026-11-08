//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: test.country-choice.js
//  Description: The countries of a card chosen by the AI among the candidates Wikidata gives: the candidates with what
//               brought them, the prompt, and the answer read as a choice among them only
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson}));
const {chooseCountries, countryCandidates, countryPrompt, normalizeChoice} = await import('../../services/utils/country-choice.js');

// Burleanu (Romanian), L'Équipe (a French newspaper), the UEFA (international body, seat in Switzerland), Infantino of FIFA
const of = new Map([
    ['Q1', {country: 'RO', international: false, bodies: [], media: false}],
    ['Q2', {country: 'FR', international: false, bodies: [], media: true}],
    ['Q3', {country: 'CH', international: true, bodies: [], media: false}],
    ['Q4', {country: 'CH', international: false, bodies: ['Q3'], media: false}],
    ['Q5', {country: null, international: false, bodies: [], media: false}],
]);
const labels = new Map([['Q1', 'Răzvan Burleanu'], ['Q2', 'L’Équipe'], ['Q3', 'UEFA'], ['Q4', 'Gianni Infantino']]);
const items = [{qid: 'Q1', weight: 5, person: true}, {qid: 'Q2', weight: 3}, {qid: 'Q3', weight: 2}, {qid: 'Q4', weight: 1, person: true}, {qid: 'Q5', weight: 9}];

describe('countryCandidates', () => {
    it('should give the countries Wikidata found, with what brought each one, the heaviest first', () => {
        const candidates = countryCandidates(items, of, labels);
        expect(candidates.map(candidate => [candidate.code, candidate.weight])).toEqual([['RO', 5], ['FR', 3], ['CH', 2]]);
        expect(candidates.find(candidate => candidate.code === 'FR').via).toEqual([{name: 'L’Équipe', person: false, media: true, international: false}]);
    });

    it('should not offer the country of a person of an international body the card names, as countries.js does not give it (8.11.2026)', () => {
        // Infantino of the UEFA's seat: Switzerland comes from the body only, and from a person of it with no weight of its own
        const swiss = countryCandidates(items, of, labels).find(candidate => candidate.code === 'CH');
        expect(swiss.via.map(via => via.name)).toEqual(['UEFA']);
        expect(swiss.weight).toBe(2);
        // the president of the UEFA is Slovenian: a card naming the UEFA and him has no candidate, the AI that kept Slovenia in 2 runs of 5
        // for a conflict of the UEFA with the FIFA is not asked
        const president = new Map([['Q3', {country: null, international: true, bodies: [], media: false}],
            ['Q6', {country: 'SI', international: false, bodies: ['Q3'], media: false}]]);
        expect(countryCandidates([{qid: 'Q3', weight: 5}, {qid: 'Q6', weight: 5, person: true}], president, new Map())).toEqual([]);
        // the same person on a card naming no body of his is Slovenian
        expect(countryCandidates([{qid: 'Q6', weight: 5, person: true}], president, new Map()).map(candidate => candidate.code)).toEqual(['SI']);
    });

    it('should leave out an item without a country, and count an item once', () => {
        expect(countryCandidates([{qid: 'Q5', weight: 4}, {qid: null, weight: 4}], of, labels)).toEqual([]);
        expect(countryCandidates([{qid: 'Q1', weight: 2}, {qid: 'Q1', weight: 5}], of, labels)[0].weight).toBe(5);
    });

    it('should give six candidates at most', () => {
        const many = new Map(Array.from({length: 9}, (_, i) => [`Q${i}`, {country: ['FR', 'DE', 'ES', 'IT', 'PT', 'NL', 'BE', 'AT', 'PL'][i], bodies: []}]));
        expect(countryCandidates([...many.keys()].map(qid => ({qid, weight: 1})), many)).toHaveLength(6);
    });
});

describe('countryPrompt', () => {
    it('should give each card its titles, its text and its candidates with where each comes from', () => {
        const prompt = countryPrompt([{titles: ['Bomb of the day! L’Equipe: Burleanu', 'Burleanu candidat'], text: 'The Romanian FA president.\nIs a candidate.', candidates: countryCandidates(items, of, labels)}]);
        expect(prompt).toContain('[1] Bomb of the day! L’Equipe: Burleanu | Burleanu candidat');
        expect(prompt).toContain('The Romanian FA president. Is a candidate.');
        expect(prompt).toContain('FR France: L’Équipe (média)');
        expect(prompt).toContain('UEFA (organisation internationale, son siège)');
        expect(prompt).not.toContain('Gianni Infantino');
        expect(prompt).toContain('RO Roumanie: Răzvan Burleanu (personne)');
    });
});

describe('normalizeChoice', () => {
    const cards = [{candidates: [{code: 'RO'}, {code: 'FR'}]}, {candidates: [{code: 'CH'}]}, {candidates: [{code: 'US'}, {code: 'CN'}, {code: 'GB'}, {code: 'DE'}]}];

    it('should keep the candidates only, once, in the order the AI gave, three at most', () => {
        const answer = {cards: [{n: 1, countries: ['ro', 'XX', 'RO', ' FR ']}, {n: '[3]', countries: ['CN', 'US', 'GB', 'DE']}]};
        expect([...normalizeChoice(answer, cards)]).toEqual([[0, ['RO', 'FR']], [2, ['CN', 'US', 'GB']]]);
    });

    it('should keep no country for a card the AI answered with none, and leave a card it did not answer out', () => {
        const chosen = normalizeChoice({cards: [{n: 2, countries: []}]}, cards);
        expect(chosen.get(1)).toEqual([]);
        expect(chosen.has(0)).toBe(false);
    });

    it('should ignore what cannot be read: a card out of the list, twice answered, with no list of countries, no answer', () => {
        const answer = {cards: [{n: 9, countries: ['RO']}, {n: 1, countries: ['RO']}, {n: 1, countries: ['FR']}, {n: 2, countries: 'CH'}, null]};
        expect([...normalizeChoice(answer, cards)]).toEqual([[0, ['RO']]]);
        expect(normalizeChoice(null, cards).size).toBe(0);
    });
});

describe('chooseCountries', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should ask the AI once for all the cards', async () => {
        ollamaJson.mockResolvedValue({cards: [{n: 1, countries: ['RO']}]});
        const cards = [{titles: ['t'], text: '', candidates: [{code: 'RO', weight: 1, via: [{name: 'Burleanu'}]}, {code: 'FR', weight: 1, via: [{name: 'L’Équipe', media: true}]}]}];
        expect([...await chooseCountries(cards)]).toEqual([[0, ['RO']]]);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should ask nothing when no card has a candidate, and let the error of the AI through', async () => {
        expect((await chooseCountries([])).size).toBe(0);
        expect(ollamaJson).not.toHaveBeenCalled();
        ollamaJson.mockRejectedValue(new Error('down'));
        await expect(chooseCountries([{titles: [], text: '', candidates: [{code: 'RO', via: []}]}])).rejects.toThrow('down');
    });
});
