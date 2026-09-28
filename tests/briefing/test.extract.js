//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.extract.js
//  Description: Tests for the key passages of an article: sentences shown as published, the AI only
//               picking their numbers, and a translation that keeps every figure
//

import {describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {buildExtract, canSummarize, extractArticle, keepsFigures, passagesText, sentencesOf, splitSentences, translatePassages} =
    await import('../../services/utils/extract.js');
const {newUsage} = await import('../../services/utils/ollama.js');

const json = (value) => ({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});
const s = (text, quote = false) => ({text, quote});

describe('splitSentences', () => {
    it('should not end a sentence at an abbreviation, a closing quote or a figure closing a parenthesis', () => {
        expect(splitSentences('Il a dit « Bonjour. » Puis M. Dupont est parti de là. Le U.S. Army a 1.5 M€ à dépenser.'))
            .toEqual(['Il a dit « Bonjour. » Puis M. Dupont est parti de là.', 'Le U.S. Army a 1.5 M€ à dépenser.']);
        expect(splitSentences("There was a bill (Rep Bill Posey's HR 8972), but it died without a vote."))
            .toHaveLength(1);
    });

    it('should cut two sentences a page glued together', () => {
        expect(splitSentences("Les Bleus ont gagné hier soir.Toute l'actualité du sport est ici."))
            .toEqual(['Les Bleus ont gagné hier soir.', "Toute l'actualité du sport est ici."]);
    });
});

describe('sentencesOf', () => {
    const content = 'x '.repeat(40);

    it('should cut sentences inside the blocks of the page, never show a heading or a caption, and mark a quote', () => {
        const sentences = sentencesOf({content, blocks: [
            {kind: 'heading', text: 'Wolfsburg force le virage'},
            {kind: 'text', text: 'La marque réajuste sa production dans ses usines. Elle réaffecte plusieurs équipes.'},
            {kind: 'caption', text: 'Le pape à Lourdes, le 27 septembre 2026.'},
            {kind: 'quote', text: 'There are a lot of skills that do not matter.'},
        ]});
        expect(sentences).toEqual([
            s('La marque réajuste sa production dans ses usines.'),
            s('Elle réaffecte plusieurs équipes.'),
            s('There are a lot of skills that do not matter.', true),
        ]);
    });

    it('should read the flat text when the blocks hold too little of it', () => {
        const flat = 'Une phrase assez longue pour compter ici. '.repeat(10);
        expect(sentencesOf({content: flat, blocks: []})).toHaveLength(10);
    });
});

describe('buildExtract and passagesText', () => {
    const sentences = [1, 2, 3, 4, 5, 6].map(n => s(`Phrase numéro ${n} de l'article.`));

    it('should keep the sentences in the order of the article, joining the ones that follow each other', () => {
        expect(buildExtract(sentences, [5, 1, 2])).toEqual([[sentences[0], sentences[1]], [sentences[4]]]);
    });

    it('should drop the numbers the article does not have, and repeated ones', () => {
        expect(buildExtract(sentences, [9, 0, 3, 3, '4'])).toEqual([[sentences[2]]]);
        expect(buildExtract(sentences, null)).toEqual([]);
    });

    it('should keep the most important sentences first when they do not all fit', () => {
        const long = [s('mot '.repeat(100).trim()), s('mot '.repeat(100).trim()), s('Une courte phrase de fin.')];
        expect(buildExtract(long, [3, 1, 2]).flat()).toEqual([long[0], long[2]]);
    });

    it('should set a paragraph per passage and a quote between quotation marks', () => {
        expect(passagesText([[s('Il a parlé.'), s('Rien ne compte.', true)], [s('Fin.')]])).toBe('Il a parlé. “Rien ne compte.”\n\nFin.');
        expect(passagesText([])).toBeNull();
    });
});

describe('keepsFigures', () => {
    it('should take the same figures written the way of another language', () => {
        expect(keepsFigures('(New York, September 21, 2026) the euro at 1.1383 dollars, 1,000 people',
            "(New York, 21 septembre 2026) l'euro à 1,1383 dollar, 1 000 personnes")).toBe(true);
    });

    it('should see a figure lost or changed', () => {
        expect(keepsFigures('He was fined $10,000.', 'Il a reçu une amende.')).toBe(false);
        expect(keepsFigures('23 goals in 23 games', '23 buts en 32 matchs')).toBe(false);
    });
});

describe('translatePassages', () => {
    const passages = [[s('He was fined $10,000.')]];

    it('should translate sentence by sentence and keep the quotes', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Il a reçu une amende de 10 000 $.']}));
        expect(await translatePassages([[s('He was fined $10,000.', true)]], 'English', 'French'))
            .toEqual([[s('Il a reçu une amende de 10 000 $.', true)]]);
    });

    it('should ask again when a figure is lost, and give up after a second failure', async () => {
        chat.mockReset()
            .mockResolvedValueOnce(json({translations: ['Il a reçu une amende.']}))
            .mockResolvedValueOnce(json({translations: ['Il a reçu une amende de 10 000 $.']}));
        expect(await translatePassages(passages, 'English', 'French')).toEqual([[s('Il a reçu une amende de 10 000 $.')]]);

        chat.mockReset().mockResolvedValue(json({translations: ['Il a reçu une amende.']}));
        expect(await translatePassages(passages, 'English', 'French')).toBeNull();
        expect(chat).toHaveBeenCalledTimes(2);
    });
});

describe('extractArticle', () => {
    const text = 'Le conseil municipal a voté la fermeture du pont aux voitures. Le vote a eu lieu mardi soir. '.repeat(5);

    it('should show the sentences picked as published, and translate nothing for a reader of their language', async () => {
        chat.mockReset().mockResolvedValueOnce(json({topic: 'politics', sourcing: 'named', sentences: [2, 1]}));
        const usage = newUsage();
        const result = await extractArticle('Le pont', {content: text, blocks: []}, {language: 'fr', usage});
        expect(result.passages).toEqual([[s('Le conseil municipal a voté la fermeture du pont aux voitures.'), s('Le vote a eu lieu mardi soir.')]]);
        expect(result.translation).toBeNull();
        expect(result).toMatchObject({from: 'fr', topic: 'politics', sourcing: 'named'});
        expect(usage.calls).toBe(1);
    });

    it('should show nothing when the page has no text of its own', async () => {
        chat.mockReset().mockResolvedValueOnce(json({topic: 'society', sourcing: 'none', sentences: []}));
        expect((await extractArticle('Vidéo', {content: text, blocks: []}, {language: 'fr'})).passages).toEqual([]);
    });
});

describe('canSummarize', () => {
    it('should not read the first lines of a page as the news', () => {
        expect(canSummarize('mot '.repeat(45))).toBe(false);
        expect(canSummarize(null)).toBe(false);
        expect(canSummarize('mot '.repeat(60))).toBe(true);
    });
});
