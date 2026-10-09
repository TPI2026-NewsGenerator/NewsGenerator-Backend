//
//  Author: Fabian Rostello
//  Date: 09.10.2026
//  File: test.profile-funnel.js
//  Description: Tests for a profile written with the AI: its questions, the answers sent back by the
//               page, and the profile it writes
//

import {jest} from '@jest/globals'

// the AI is never called by these tests, only its answers are read
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson: jest.fn()}));
const {ollamaJson} = await import('../../services/utils/ollama.js');
const {cleanRounds, MAX_QUESTIONS, MAX_ROUNDS, nextQuestions, normalizeQuestions, questionsPrompt, writeProfile, writePrompt} =
    await import('../../services/utils/profile-funnel.js');

const answered = (question, options, chosen = [], free = '') => ({question, options, chosen, free});

beforeEach(() => ollamaJson.mockReset());

describe('normalizeQuestions', () => {
    it('should keep each question with its choices, cleaned and never twice the same', () => {
        expect(normalizeQuestions({questions: [
            {question: '  Quelles  compétitions ? ', options: ['Ligue des champions', ' Ligue des champions', 'Euro', '', 3]},
            {question: '', options: ['sans question']},
            {question: 'Sans choix'},
        ]})).toEqual([
            {question: 'Quelles compétitions ?', options: ['Ligue des champions', 'Euro']},
            {question: 'Sans choix', options: []},
        ]);
    });

    it(`should keep ${MAX_QUESTIONS} questions of 8 choices at most, and nothing of a wrong answer`, () => {
        const many = {questions: Array.from({length: 9}, (_, i) => ({question: `Q${i}`, options: Array.from({length: 12}, (_, j) => `o${j}`)}))};
        const questions = normalizeQuestions(many);
        expect(questions).toHaveLength(MAX_QUESTIONS);
        expect(questions[0].options).toHaveLength(8);
        expect(normalizeQuestions(null)).toEqual([]);
        expect(normalizeQuestions({questions: 'non'})).toEqual([]);
    });
});

describe('cleanRounds', () => {
    it('should keep only the choices ticked that were offered', () => {
        const [[question]] = cleanRounds([[{question: 'Quelles nouvelles ?', options: ['Désignations', 'Sanctions'],
            chosen: ['Sanctions', 'Transferts', 'Sanctions'], free: '  les   nouvelles règles  '}]]);
        expect(question).toEqual(answered('Quelles nouvelles ?', ['Désignations', 'Sanctions'], ['Sanctions'], 'les nouvelles règles'));
    });

    it(`should keep ${MAX_ROUNDS} rounds at most, and nothing that is not a round`, () => {
        const round = [answered('Q', ['a'])];
        expect(cleanRounds(Array.from({length: 5}, () => round))).toHaveLength(MAX_ROUNDS);
        expect(cleanRounds('non')).toEqual([]);
        expect(cleanRounds([[{options: ['a']}], 'x'])).toEqual([]);
    });
});

describe('nextQuestions', () => {
    const start = "Je travaille dans l'arbitrage à l'UEFA.";
    const round = [answered('Quelles nouvelles ?', ['Désignations', 'Sanctions'], ['Désignations'])];

    it('should ask the first round even when the AI says it has enough', async () => {
        ollamaJson.mockResolvedValue({enough: true, questions: [{question: 'Quels autres sujets ?', options: ['Politique', 'Sciences']}]});
        expect(await nextQuestions({start, rounds: [], language: 'fr'})).toEqual({
            enough: false, questions: [{question: 'Quels autres sujets ?', options: ['Politique', 'Sciences']}],
        });
    });

    it('should stop when the AI has enough after a round, or gives no question', async () => {
        ollamaJson.mockResolvedValue({enough: true, questions: [{question: 'Encore ?', options: []}]});
        expect(await nextQuestions({start, rounds: [round], language: 'fr'})).toEqual({enough: true, questions: []});
        ollamaJson.mockResolvedValue({enough: false, questions: []});
        expect(await nextQuestions({start, rounds: [round], language: 'fr'})).toEqual({enough: true, questions: []});
    });

    it('should not ask the AI after the last round', async () => {
        expect(await nextQuestions({start, rounds: Array.from({length: MAX_ROUNDS}, () => round), language: 'fr'}))
            .toEqual({enough: true, questions: []});
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should not ask again a question the reader passed, even when the AI does', async () => {
        const passed = [round[0], answered('Quelle portée géographique souhaitez-vous pour vos veilles ?', ['Europe', 'Monde'])];
        ollamaJson.mockResolvedValue({enough: false, questions: [
            {question: 'Quelle portée géographique souhaitez-vous pour vos veilles ?', options: ['Europe', 'Monde']},
            {question: 'Quelle portée géographique pour vos veilles d\'actualité ?', options: ['Europe']},
            {question: 'Quels pays vous intéressent ?', options: ['Suisse', 'France']},
            {question: 'Quelles sanctions ?', options: ['Suspensions', 'Amendes']},
        ]});
        expect((await nextQuestions({start, rounds: [passed], language: 'fr'})).questions.map(q => q.question))
            .toEqual(['Quels pays vous intéressent ?', 'Quelles sanctions ?']);
        expect(questionsPrompt({start, rounds: [passed], language: 'fr'})).toContain('Il l\'a passée sans rien cocher ni écrire.');
    });

    it('should give the AI what the reader ticked and wrote, and ask for other subjects first', () => {
        const prompt = questionsPrompt({start, rounds: [[answered('Quelles nouvelles ?', ['Désignations', 'Sanctions'], ['Désignations'], 'les règles du jeu')]], language: 'fr'});
        expect(prompt).toContain(`"""${start}"""`);
        expect(prompt).toContain('Il a coché : Désignations');
        expect(prompt).toContain('Il a écrit : les règles du jeu');
        expect(prompt).toContain(`Ce tour est le 2e sur ${MAX_ROUNDS}`);
        expect(prompt).toContain('quels autres sujets il veut suivre');
        expect(prompt).toContain('traduites en français');
    });
});

describe('writeProfile', () => {
    it('should keep the paragraphs of the profile written', async () => {
        ollamaJson.mockResolvedValue({text: " Je suis l'arbitrage  de l'UEFA. \n\n\n\nJe ne veux pas   les transferts. "});
        expect(await writeProfile({start: 'UEFA', rounds: []})).toBe("Je suis l'arbitrage de l'UEFA.\n\nJe ne veux pas les transferts.");
    });

    it('should answer nothing when the AI wrote nothing', async () => {
        ollamaJson.mockResolvedValue({text: 42});
        expect(await writeProfile({start: 'UEFA', rounds: []})).toBe('');
    });

    it('should tell the AI to write only what was ticked or written', () => {
        const prompt = writePrompt({start: 'Le tennis.', rounds: [[answered('Quels tournois ?', ['Roland-Garros', 'Wimbledon'], ['Wimbledon'])]], language: 'en'});
        expect(prompt).toContain('Il a coché : Wimbledon');
        expect(prompt).toContain('en anglais');      // the language chosen, not the one of the start
        expect(prompt).toContain("N'ajoute rien qu'il n'a ni coché ni écrit");
    });
});
