//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-discovery.js
//  Description: Tests for the candidates the news name (fifa-discovery.js): the sentences that hold FIFA, a word of president and a word of candidacy, the persons named in
//               them, what a model is asked and what its answer is worth, and the verdict of the code on two readings. Pure: no news is read
//

import {describe, expect, it} from '@jest/globals';
import {candidateSentences, candidateVerdictOf, collectPersons, judgmentOf, MIN_MEDIA, personsIn, promptOfCandidate} from '../../services/utils/fifa-discovery.js';

const TASHIMA = {qid: 'Q2633169', name: 'Kozo Tashima'};
const WENGER = {qid: 'Q47576', name: 'Arsène Wenger'};
const MACRON = {qid: 'Q3052772', name: 'Emmanuel Macron'};
let id = 0;
const item = (text, medium, more = {}) => ({id: ++id, title: '', description: '', text, lang: 'en', medium, at: '2026-11-10T10:00:00Z', ...more});

describe('candidateSentences', () => {
    it('should keep the sentences that hold FIFA, a word of president and a word of candidacy, in several languages', () => {
        const text = [
            'Kozo Tashima is the first challenger for the FIFA presidency, his federation said.',
            'Le président de la Fédération japonaise est candidat à la présidence de la FIFA.',
            'Ramón Vega oficializa su candidatura a la presidencia de la FIFA.',
            'Der FIFA-Präsident muss mit einer Kandidatur von Wenger rechnen.',
        ].join(' ');
        expect(candidateSentences(text)).toHaveLength(4);
    });

    it('should leave out a sentence with only some of the three words', () => {
        expect(candidateSentences('The president of the federation spoke. Wenger is a candidate. The FIFA congress opens in Rabat.')).toEqual([]);
    });
});

describe('personsIn', () => {
    it('should name a person by the full name or by the last word when no other person of the article ends with it', () => {
        expect(personsIn('Tashima will run for the FIFA presidency.', [TASHIMA, WENGER])).toEqual([TASHIMA]);
        expect(personsIn('Arsène Wenger will run.', [TASHIMA, WENGER])).toEqual([WENGER]);
        expect(personsIn('The weather is fine.', [TASHIMA, WENGER])).toEqual([]);
    });

    it('should not take a last word two persons of the article share, nor a word that is too short', () => {
        const names = [{qid: 'Q1', name: 'Jean Martin'}, {qid: 'Q2', name: 'Paul Martin'}, {qid: 'Q3', name: 'Li Wu'}];
        expect(personsIn('Martin will run for the FIFA presidency.', names)).toEqual([]);
        expect(personsIn('Jean Martin will run.', names)).toEqual([{qid: 'Q1', name: 'Jean Martin'}]);
        expect(personsIn('Wu will run.', names)).toEqual([]);
    });
});

describe('collectPersons', () => {
    const news = [
        item('Kozo Tashima, nominated by the JFA, will run for the FIFA presidency.', 'bbc.co.uk'),
        item('Tashima is the first challenger for the FIFA presidency.', 'lemonde.fr'),
        item('Tashima is the first challenger for the FIFA presidency.', 'lemonde.fr'),
        item('Emmanuel Macron urges Arsène Wenger to be a FIFA presidency candidate.', 'welt.de'),
        item('The weather was fine.', 'nobody.com'),
    ];
    const persons = (list) => list.flatMap(one => [TASHIMA, WENGER, MACRON].map(person => ({id: one.id, ...person})));

    it('should count the media and the articles each person is named in as a candidate, with a sample sentence from each medium', () => {
        const found = collectPersons({news, persons: persons(news)});
        expect([...found.keys()].sort()).toEqual([MACRON.qid, TASHIMA.qid, WENGER.qid].sort());
        const tashima = found.get(TASHIMA.qid);
        expect(tashima.media.size).toBe(2);
        expect(tashima.articles.size).toBe(3);
        expect(tashima.samples.map(sample => sample.medium)).toEqual(['bbc.co.uk', 'lemonde.fr']);
        expect(tashima.samples[0]).toMatchObject({language: 'en', date: '2026-11-10', sentence: expect.stringContaining('JFA')});
    });

    it('should skip the persons it is told to skip (already on the map, taken off by an administrator)', () => {
        const found = collectPersons({news, persons: persons(news), skip: new Set([TASHIMA.qid])});
        expect(found.has(TASHIMA.qid)).toBe(false);
        expect(found.has(WENGER.qid)).toBe(true);
    });
});

describe('promptOfCandidate and judgmentOf', () => {
    const samples = [{medium: 'bbc.co.uk', language: 'en', date: '2026-11-10', sentence: 'Kozo Tashima, nominated by the JFA, will run for the FIFA presidency.'}];

    it('should give the model the person and the sentences, each with its medium', () => {
        const prompt = promptOfCandidate({name: 'Kozo Tashima', samples});
        expect(prompt).toContain('Person: Kozo Tashima');
        expect(prompt).toContain('1. [bbc.co.uk, en] Kozo Tashima, nominated by the JFA');
    });

    it('should keep "declared" or "rumoured" with words held in the sentences, and "no" as it is', () => {
        expect(judgmentOf({status: 'declared', quote: 'will run for the FIFA presidency'}, samples)).toEqual({status: 'declared', quote: 'will run for the FIFA presidency'});
        expect(judgmentOf({status: 'rumoured', quote: 'nominated by the JFA'}, samples)).toMatchObject({status: 'rumoured'});
        expect(judgmentOf({status: 'no', quote: ''}, samples)).toEqual({status: 'no', quote: ''});
    });

    it('should turn into "no" an answer whose words are not in the sentences, and give nothing for an answer that is none', () => {
        expect(judgmentOf({status: 'declared', quote: 'he announced his candidacy on Monday'}, samples)).toEqual({status: 'no', quote: '', unheld: true});
        expect(judgmentOf({status: 'declared'}, samples)).toMatchObject({status: 'no'});
        for (const answer of [null, 'declared', {status: 'maybe'}, {}]) expect(judgmentOf(answer, samples)).toBeNull();
    });
});

describe('candidateVerdictOf', () => {
    const say = (status) => ({status, quote: 'words'});

    it('should add a candidate both models say is declared in two media, as declared', () => {
        expect(candidateVerdictOf({first: say('declared'), second: say('declared'), media: MIN_MEDIA.declared})).toMatchObject({add: true, status: 'declared', quote: 'words'});
    });

    it('should add a rumour only in five media, and call "rumoured" what the models do not both call declared', () => {
        expect(candidateVerdictOf({first: say('declared'), second: say('rumoured'), media: 4})).toMatchObject({add: false, why: 'too_few_media', status: 'rumoured'});
        expect(candidateVerdictOf({first: say('declared'), second: say('rumoured'), media: MIN_MEDIA.rumoured})).toMatchObject({add: true, status: 'rumoured'});
        expect(candidateVerdictOf({first: say('rumoured'), second: say('rumoured'), media: 13})).toMatchObject({add: true, status: 'rumoured'});
    });

    it('should add nobody when either model says no, or when a model gave no answer', () => {
        expect(candidateVerdictOf({first: say('declared'), second: say('no'), media: 80})).toMatchObject({add: false, why: 'not_a_candidate'});
        expect(candidateVerdictOf({first: say('no'), second: say('no'), media: 80})).toMatchObject({add: false});
        expect(candidateVerdictOf({first: say('declared'), second: null, media: 80})).toEqual({add: false, why: 'unread'});
        expect(candidateVerdictOf({first: null, second: null, media: 80})).toEqual({add: false, why: 'unread'});
    });
});
