//
//  Author: Fabian Rostello
//  Date: 28.09.2026
//  File: test.extract.js
//  Description: Tests for the key passages of an article: sentences shown as published, the AI only
//               picking their numbers, and a translation that keeps every figure
//

import process from 'node:process';
import {describe, expect, it, jest} from '@jest/globals';

// no Gemini to answer in the place of the Ollama that fails here: a key from the .env would send the prompts of the tests to it
process.env.AISTUDIO_API_KEY = '';
const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {ORIGINAL_END, ORIGINAL_START, buildExtract, canSummarize, extractArticle, keepsFigures, passagesText, sentencesOf, shorterWays, splitSentences, translatePassages, translateTexts, translateTextsSure, translationFor, withoutDateline, withoutOriginalMarks} =
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

    it('should leave a dash or a bullet left of a dateline out of the sentence (28.10.2026)', () => {
        expect(splitSentences("Zurich, 27 October 2026.\n—- The IFAB's panels held an online meeting chaired by its Secretary General."))
            .toEqual(['Zurich, 27 October 2026.', "The IFAB's panels held an online meeting chaired by its Secretary General."]);
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

describe('shorterWays', () => {
    const sentences = [1, 2, 3, 4, 5, 6].map(n => s(`Phrase numéro ${n} de l'article.`));

    it('should give the most important sentences as points, one each, the most important first', () => {
        expect(shorterWays(sentences, [5, 1, 2, 4]).points).toEqual([[sentences[4]], [sentences[0]], [sentences[1]]]);
        expect(shorterWays(sentences, null)).toEqual({points: [], digest: []});
    });

    it('should keep the digest within 5 to 6 lines of a card, in the order of the article', () => {
        const long = [s('mot '.repeat(30).trim()), s('mot '.repeat(30).trim()), s('mot '.repeat(30).trim()), s('Une courte phrase de fin.')];
        expect(shorterWays(long, [3, 1, 4, 2]).digest).toEqual([[long[0]], [long[2], long[3]]]);
    });

    it('should always keep the most important sentence in the digest, however long', () => {
        const long = [s('mot '.repeat(80).trim()), s('Une courte phrase de fin.')];
        expect(shorterWays(long, [1, 2]).digest).toEqual([[long[0]]]);
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

    it('should take a time of the 12-hour clock written on the 24-hour one', () => {
        expect(keepsFigures('The crew will speak at 7 p.m. on Monday.', "L'équipage parlera lundi à 19h00.")).toBe(true);
        expect(keepsFigures('Doors open at 7:30 PM and close at 12 a.m.', 'Les portes ouvrent à 19:30 et ferment à 0 h.')).toBe(true);
        expect(keepsFigures('It starts at 11am.', 'Cela commence à 11 h.')).toBe(true);
        expect(keepsFigures('The crew will speak at 7 p.m.', "L'équipage parlera à 17h00.")).toBe(false);
        expect(keepsFigures('A 5 amp fuse', 'Un fusible de 17 ampères')).toBe(false);
    });

    it('should take a time written with a dot, a colon or on the 12-hour clock as the same', () => {
        expect(keepsFigures('am Samstag (18.30 Uhr/Sky)', 'on Saturday (6:30 p.m./Sky)')).toBe(true);
        expect(keepsFigures('Kick-off 18:30', 'Coup d’envoi à 18.30')).toBe(true);
        expect(keepsFigures('am Samstag (18.30 Uhr)', 'on Saturday (6:45 p.m.)')).toBe(false);
        expect(keepsFigures('a 2:1 win', 'a 2:1 win')).toBe(true);
    });

    it('should take the digits of Arabic and Persian as ours', () => {
        expect(keepsFigures('خسر ٢-٠ أمام الأهلي', 'lost 2-0 to Al Ahly')).toBe(true);
        expect(keepsFigures('خسر ٢-٠ أمام الأهلي', 'lost 3-0 to Al Ahly')).toBe(false);
        expect(keepsFigures('۱٫۵ میلیون', '1.5 million')).toBe(true);
    });

    it('should take "1/8-finals" and the round of 16 as the same', () => {
        expect(keepsFigures('Въвеждат ВАР за 1/8-финалите', 'VAR will come in the round of 16')).toBe(true);
        expect(keepsFigures('VAR comes in the round of 16', 'Le VAR arrive en 1/8 de finale')).toBe(true);
        expect(keepsFigures('Въвеждат ВАР за 1/8-финалите', 'VAR will come in the round of 32')).toBe(false);
        expect(keepsFigures('1/3 of the vote', 'a third of the vote')).toBe(false);
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

        // one sentence that never comes: nothing to show of the translation
        chat.mockReset().mockResolvedValue(json({translations: ['Il a reçu une amende.']}));
        expect(await translatePassages(passages, 'English', 'French')).toBeNull();
        expect(chat).toHaveBeenCalledTimes(3);
    });

    const three = [[s('The VAR comes in the 1/8-finals.'), s('He was fined $10,000.', true)], [s('It ends on Sunday.')]];

    it('should keep the sentences translated and ask again only the ones that lost a figure, telling the AI so', async () => {
        chat.mockReset()
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale.', 'Il a reçu une amende.', 'Cela finit dimanche.']}))
            .mockResolvedValueOnce(json({translations: ['Il a reçu une amende de 10 000 $.']}));
        expect(await translatePassages(three, 'English', 'French')).toEqual([
            [s('Le VAR arrive en 1/8 de finale.'), s('Il a reçu une amende de 10 000 $.', true)], [s('Cela finit dimanche.')]]);
        expect(chat).toHaveBeenCalledTimes(2);
        const second = chat.mock.calls[1][0].messages.at(-1).content;
        expect(second).toContain('[1] He was fined $10,000.');
        expect(second).not.toContain('VAR');
        expect(second).toContain('lost or changed a figure');
        expect(chat.mock.calls[0][0].messages.at(-1).content).not.toContain('lost or changed a figure');
    });

    it('should leave a sentence it cannot translate with its figures in its own language between parentheses', async () => {
        // the three together: the second sentence loses its figure; then alone, it always does
        chat.mockReset().mockImplementation(async ({messages}) => json({translations: messages.at(-1).content.includes('[3]')
            ? ['Le VAR arrive en 1/8 de finale.', 'Il a reçu une amende.', 'Cela finit dimanche.'] : ['Il a reçu une amende.']}));

        expect(await translatePassages(three, 'English', 'French')).toEqual([
            [s('Le VAR arrive en 1/8 de finale.'), s('(“He was fined $10,000.”)')], [s('Cela finit dimanche.')]]);
        // in a briefing it is the translation that is shown, marked to be in italics, with a warning (see below)
        expect((await translatePassages(three, 'English', 'French', null, {marked: true}))[0][1])
            .toEqual(s(`${ORIGINAL_START}“Il a reçu une amende.” ⚠${ORIGINAL_END}`));
        expect(withoutOriginalMarks(`a ${ORIGINAL_START}(b)${ORIGINAL_END} c`)).toBe('a (b) c');
    });

    it('should show in a briefing the translation of a sentence whose figures it could not check, in italics with a warning (8.11.2026)', async () => {
        // the second sentence never gets its figure back: the AI wrote "Il a reçu une amende." three times
        const unchecked = () => chat.mockReset().mockImplementation(async ({messages}) => json({translations: messages.at(-1).content.includes('[3]')
            ? ['Le VAR arrive en 1/8 de finale.', 'Il a reçu une amende.', 'Cela finit dimanche.'] : ['Il a reçu une amende.']}));
        unchecked();

        const marked = await translatePassages(three, 'English', 'French', null, {marked: true});

        // its quotation marks stay around its words, the warning after them, all of it in italics
        expect(marked[0][1]).toEqual(s(`${ORIGINAL_START}“Il a reçu une amende.” ⚠${ORIGINAL_END}`));
        expect(marked[0][0]).toEqual(s('Le VAR arrive en 1/8 de finale.'));
        expect(withoutOriginalMarks(marked[0][1].text)).toBe('“Il a reçu une amende.” ⚠');
        // a page that cannot show a warning (the search) keeps the sentence in its own language, between parentheses
        unchecked();
        expect((await translatePassages(three, 'English', 'French'))[0][1]).toEqual(s('(“He was fined $10,000.”)'));
    });

    it('should leave in its own language a sentence the AI did not translate at all, even in a briefing', async () => {
        // the second sentence comes back empty every time
        chat.mockReset().mockImplementation(async ({messages}) => json({translations: messages.at(-1).content.includes('[3]')
            ? ['Le VAR arrive en 1/8 de finale.', '', 'Cela finit dimanche.'] : ['']}));

        const marked = await translatePassages(three, 'English', 'French', null, {marked: true});

        expect(marked[0][1]).toEqual(s(`${ORIGINAL_START}(“He was fined $10,000.”)${ORIGINAL_END}`));
    });

    it('should show a translation whose figures it could not check even when most of the sentences are so, in a briefing only', async () => {
        // every sentence loses a figure: the translation is shown with a warning each in a briefing, none anywhere else
        chat.mockReset().mockResolvedValue(json({translations: ['Le VAR arrive.', 'Il a reçu une amende.', 'Cela finit.']}));
        const marked = await translatePassages(three, 'English', 'French', null, {marked: true});
        expect(marked.flat().map(sentence => withoutOriginalMarks(sentence.text))).toEqual(['Le VAR arrive. ⚠', '“Il a reçu une amende.” ⚠', 'Cela finit.']);
        expect(await translatePassages(three, 'English', 'French')).toBeNull();
    });

    it('should give no translation when it could not translate half of the sentences', async () => {
        chat.mockReset().mockResolvedValue(json({translations: ['Rien.', 'Rien.', 'Rien.']}));
        expect(await translatePassages(three, 'English', 'French')).toBeNull();
    });
});

describe('translatePassages and translationFor, an AI that fails', () => {
    const two = [[s('The VAR comes in the 1/8-finals.')], [s('It ends on Sunday.')]];

    it('should ask one sentence at a time when the AI answers another number of translations', async () => {
        chat.mockReset()
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale. Cela finit dimanche.']}))
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale.']}))
            .mockResolvedValueOnce(json({translations: ['Cela finit dimanche.']}));
        expect(await translatePassages(two, 'English', 'French')).toEqual([[s('Le VAR arrive en 1/8 de finale.')], [s('Cela finit dimanche.')]]);
        expect(chat).toHaveBeenCalledTimes(3);
        expect(chat.mock.calls[1][0].messages.at(-1).content).not.toContain('Sunday');
    });

    it('should ask again a call that failed instead of losing the translation of the card', async () => {
        chat.mockReset()
            .mockRejectedValueOnce(Object.assign(new Error('no answer'), {status_code: 502}))
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale.', 'Cela finit dimanche.']}));
        expect(await translatePassages(two, 'English', 'French')).toEqual([[s('Le VAR arrive en 1/8 de finale.')], [s('Cela finit dimanche.')]]);
    });

    it('should ask one sentence at a time when the AI answers something that is no JSON', async () => {
        chat.mockReset()
            .mockResolvedValueOnce({message: {content: '{"translations": [1] "The VAR comes in the 1/8-finals.", [2] "It ends on Sunday."]}'}})
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale.']}))
            .mockResolvedValueOnce(json({translations: ['Cela finit dimanche.']}));
        expect(await translatePassages(two, 'English', 'French')).toEqual([[s('Le VAR arrive en 1/8 de finale.')], [s('Cela finit dimanche.')]]);
        expect(chat).toHaveBeenCalledTimes(3);
    });

    it('should ask the whole card again, after a pause, when a briefing finds it without its translation', async () => {
        // the AI is down for the three tries of the first round, back for the second
        chat.mockReset().mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce(json({translations: ['Le VAR arrive en 1/8 de finale.', 'Cela finit dimanche.']}));
        const {from, translation} = await translationFor(two, 'fr', null, 'en', {marked: true});
        expect(from).toBe('en');
        expect(translation).toEqual([[s('Le VAR arrive en 1/8 de finale.')], [s('Cela finit dimanche.')]]);

        // the search, which answers a reader waiting, does not ask it again
        chat.mockReset().mockRejectedValue(new Error('down'));
        expect((await translationFor(two, 'fr', null, 'en')).translation).toBeNull();
        expect(chat).toHaveBeenCalledTimes(3);
    });

    it('should read the language of the passages from their letters, not from the label of the page: Persian passages of an English page', async () => {
        const persian = [[s('به گزارش سایت رسمی فدراسیون فوتبال، فیفا در گزارشی با اشاره به نتایج درخشان دختران فوتسالیست ایران، از این تیم به عنوان یکی از مدعیان جدی رسیدن به دیدار پایانی یاد کرد.')]];
        chat.mockReset().mockResolvedValueOnce(json({translations: ['According to the official site of the federation, FIFA named the team.']}));
        const {from, translation} = await translationFor(persian, 'en', null, 'en', {marked: true});
        expect(from).toBe('fa');
        expect(translation[0][0].text).toContain('FIFA');
    });
});

describe('translatePassages with the spelling of the names', () => {
    it('should tell the AI how Wikidata spells the names of the news, in every try', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Frappart led the seminar in 2026.']}));
        await translatePassages([[s('Η Φραπάρ έκανε το σεμινάριο το 2026.')]], 'Greek', 'English', null,
            {glossary: [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}]});
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('another alphabet than');
        expect(prompt).toContain('“Φραπάρ” is Stéphanie Frappart');
    });

    it('should put back a name written a consonant off the spelling of Wikidata, a figure kept', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Frapar led the seminar in 2026.']}));
        expect(await translatePassages([[s('Η Φραπάρ έκανε το σεμινάριο το 2026.')]], 'Greek', 'English', null,
            {glossary: [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}]}))
            .toEqual([[s('Frappart led the seminar in 2026.')]]);
    });

    it('should tell the AI the spelling the other news of the card give to the names, and put back a name off it', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['The president, Stéphane Lanoy, spoke in 2026.']}));
        expect(await translatePassages([[s('Ο πρόεδρος, Στεφάν Λανουά, μίλησε το 2026.')]], 'Greek', 'English', null, {names: ['Stéphane Lannoy']}))
            .toEqual([[s('The president, Stéphane Lannoy, spoke in 2026.')]]);
        expect(chat.mock.calls[0][0].messages.at(-1).content).toContain('already spells Stéphane Lannoy');
    });

    it('should tell nothing of names when it has none', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['He was fined $10,000.']}));
        await translatePassages([[s('Il a reçu une amende de 10 000 $.')]], 'French', 'English');
        expect(chat.mock.calls[0][0].messages.at(-1).content).not.toContain('Wikidata spells');
    });
});

describe('translateTexts', () => {
    const texts = [{text: 'Bayern gewinnt 3:1 in Dortmund', from: 'German'}, {text: 'El árbitro anuló el gol', from: 'Spanish'}];

    it('should name the language of each text and translate them all in one call', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]}));
        expect(await translateTexts(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('[1] (German) Bayern gewinnt 3:1 in Dortmund');
        expect(prompt).toContain('[2] (Spanish) El árbitro anuló el gol');
    });

    it('should not keep the number and the language the AI writes again before a translation', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['[1] Le Bayern gagne 3-1 à Dortmund', "[2] (Spanish) L'arbitre a annulé le but"]}));
        expect(await translateTexts(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
    });

    it('should ask for the names of another alphabet as the press spells them, a man\'s first name staying a man\'s', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]}));
        await translateTexts(texts, 'French');
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('another alphabet than');
        expect(prompt).toContain('never becomes a woman');
        // nothing told of the spelling of a name when the texts have none
        expect(prompt).not.toContain('already spells');
        expect(prompt).not.toContain('Wikidata spells');
    });

    it('should tell each text how Wikidata and its card spell its names, and put back a name a consonant off (briefings 252 and 253, 27.10.2026)', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ["Thessaloniki: Women's refereeing seminar with UEFA's Frapar", 'A second title']}));
        const names = ['Stéphanie Frappart', 'Thessaloniki'];
        const glossary = [{written: 'Φραπάρ', spelled: 'Stéphanie Frappart'}];
        const answer = await translateTexts([
            {text: 'Θεσσαλονίκη: Σεμινάριο γυναικείας διαιτησίας με τη Φραπάρ της UEFA', from: 'Greek', names, glossary},
            {text: 'Ένας δεύτερος τίτλος', from: 'Greek'},
        ], 'English');
        expect(answer).toEqual(["Thessaloniki: Women's refereeing seminar with UEFA's Frappart", 'A second title']);
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('“Φραπάρ” is Stéphanie Frappart');
        expect(prompt).toContain('already spells Stéphanie Frappart, Thessaloniki');
        // the second text is told nothing
        expect(prompt.split('[2]')[1]).not.toContain('Wikidata spells');
    });

    it('should not change a name the original writes as it is', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Frapar leads the seminar']}));
        expect(await translateTexts([{text: 'Frapar leads the seminar', from: 'Greek', names: ['Stéphanie Frappart']}], 'English'))
            .toEqual(['Frapar leads the seminar']);
    });

    it('should leave out a translation that lost a figure, and ask one text at a time after an answer of another length', async () => {
        chat.mockReset()
            // one translation for two texts: the two are asked one at a time, as the same list asked again came back as short
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne']}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne à Dortmund']}))
            .mockResolvedValueOnce(json({translations: ["L'arbitre a annulé le but"]}))
            // the text that lost its figure is asked once more, alone (a last call, that loses it again here)
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne à Dortmund']}));
        expect(await translateTexts(texts, 'French')).toEqual([null, "L'arbitre a annulé le but"]);
        expect(chat).toHaveBeenCalledTimes(4);
        expect(chat.mock.calls[1][0].messages.at(-1).content).not.toContain('El árbitro');

        chat.mockReset().mockResolvedValue(json({nothing: true}));
        expect(await translateTexts(texts, 'French')).toEqual([null, null]);
    });

    it('should ask again a call that failed, and give up on the texts left when the AI does not answer', async () => {
        // the AI busy for two calls, then answering: the titles are translated all the same (the waits are none in the tests)
        chat.mockReset()
            .mockRejectedValueOnce(Object.assign(new Error('busy'), {status_code: 502}))
            .mockRejectedValueOnce(Object.assign(new Error('busy'), {status_code: 502}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]}));
        expect(await translateTexts(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
        expect(chat).toHaveBeenCalledTimes(3);

        // down for good: nothing is lost but the translation, and the asking stops (3 calls of the one try, not 3 tries of 3)
        chat.mockReset().mockRejectedValue(Object.assign(new Error('down'), {status_code: 502}));
        expect(await translateTexts(texts, 'French')).toEqual([null, null]);
        expect(chat.mock.calls.length).toBeLessThanOrEqual(9);
    });

    it('should ask again, told of the figures, for a text that came back without one, and keep the ones that came back whole', async () => {
        chat.mockReset()
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne à Dortmund', "L'arbitre a annulé le but"]}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund']}));
        expect(await translateTexts(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
        expect(chat).toHaveBeenCalledTimes(2);
        // the second call has the text that lost its figure only, and says why
        const prompt = chat.mock.calls[1][0].messages.at(-1).content;
        expect(prompt).toContain('lost or changed a figure');
        expect(prompt).toContain('[1] (German) Bayern gewinnt 3:1 in Dortmund');
        expect(prompt).not.toContain('El árbitro');
    });
});

describe('translateTextsSure', () => {
    const texts = [{text: 'Bayern gewinnt 3:1 in Dortmund', from: 'German'}, {text: 'El árbitro anuló el gol', from: 'Spanish'}];

    it('should ask once more the texts that came back empty, and the ones only', async () => {
        // the first round: the first text comes back without its figure three times; the second round answers it whole
        chat.mockReset()
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne', "L'arbitre a annulé le but"]}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne']}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne']}))
            .mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund']}));
        expect(await translateTextsSure(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
        expect(chat.mock.calls.at(-1)[0].messages.at(-1).content).not.toContain('El árbitro');
    });

    it('should leave null the text that is still empty, and ask nothing more when every text came back', async () => {
        chat.mockReset().mockResolvedValue(json({translations: ['Le Bayern gagne']}));
        expect((await translateTextsSure([texts[0]], 'French'))[0]).toBeNull();

        chat.mockReset().mockResolvedValueOnce(json({translations: ['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]}));
        expect(await translateTextsSure(texts, 'French')).toEqual(['Le Bayern gagne 3-1 à Dortmund', "L'arbitre a annulé le but"]);
        expect(chat).toHaveBeenCalledTimes(1);
    });
});

describe('translateTexts, a language only guessed', () => {
    it('should ask the language of the texts marked as a guess, and give the one the AI says at their place', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Slovenia wins', 'Bayern wins 3-1'], languages: ['Slovenian', null]}));
        const languages = [];
        const answer = await translateTexts([{text: 'Slovenija zmaguje', from: 'Bosnian', guess: true}, {text: 'Bayern gewinnt 3-1', from: 'German'}], 'English', null, {languages});
        expect(answer).toEqual(['Slovenia wins', 'Bayern wins 3-1']);
        expect(languages[0]).toBe('Slovenian');
        expect(languages[1]).toBeUndefined();
        const prompt = chat.mock.calls[0][0].messages.at(-1).content;
        expect(prompt).toContain('[1] (Bosnian?) Slovenija zmaguje');
        expect(prompt).toContain('[2] (German) Bayern gewinnt 3-1');
        expect(prompt).toContain('"languages"');
    });

    it('should neither ask nor answer a language when no text is a guess', async () => {
        chat.mockReset().mockResolvedValueOnce(json({translations: ['Bayern wins 3-1'], languages: ['German']}));
        const languages = [];
        await translateTexts([{text: 'Bayern gewinnt 3-1', from: 'German'}], 'English', null, {languages});
        expect(chat.mock.calls[0][0].messages.at(-1).content).not.toContain('"languages"');
        expect(languages).toEqual([]);
    });
});

describe('keepsFigures, the dates', () => {
    it('should take a date written 5/11 for the same one written with the name of its month (a Vietnamese card of 6.11.2026 lost all its translation)', () => {
        expect(keepsFigures('Hội nghị diễn ra ngày 5/11 tại Thành phố Hồ Chí Minh', 'The conference took place on November 5 in Ho Chi Minh City')).toBe(true);
        expect(keepsFigures('từ ngày 20/2 đến 20/6', 'from 20 February to 20 June')).toBe(true);
        expect(keepsFigures('từ ngày 28/7 đến 8/8', 'from July 28 to August 8')).toBe(true);
        expect(keepsFigures('Reunión el 5 de noviembre', 'Meeting on the 5th of November')).toBe(true);
        expect(keepsFigures('tháng 11 năm 2026', 'November 2026')).toBe(true);
        expect(keepsFigures('le 3/5', 'le 3 mai')).toBe(true);
    });

    it('should still refuse a figure that is lost, whatever the month the translation names', () => {
        expect(keepsFigures('ngày 5/11 có 20 đội', 'on November 5 there were teams')).toBe(false);
        // the month is named once: a second figure of the original is not it
        expect(keepsFigures('11 đội vào ngày 5/11', 'teams on November 5')).toBe(false);
        // "may" is a month only beside a figure
        expect(keepsFigures('5 đội', 'it may be teams')).toBe(false);
        expect(keepsFigures('ngày 5/5', 'on May 5')).toBe(true);
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

    it('should translate the shorter ways with the sentences of the passages, in no other call', async () => {
        const english = 'The city council voted to close the bridge to cars on the river. The vote took place on Tuesday evening at the town hall. '.repeat(5);
        const translations = ['Le conseil municipal a voté la fermeture du pont aux voitures sur la rivière.', 'Le vote a eu lieu mardi soir à la mairie.'];
        chat.mockReset()
            .mockResolvedValueOnce(json({topic: 'politics', sourcing: 'named', sentences: [2, 1]}))
            .mockResolvedValueOnce(json({translations}));
        const usage = newUsage();
        const result = await extractArticle('The bridge', {content: english, blocks: []}, {language: 'fr', usage});
        expect(result.points.map(([sentence]) => sentence.text)).toEqual([
            'The vote took place on Tuesday evening at the town hall.', 'The city council voted to close the bridge to cars on the river.']);
        expect(result.pointsTranslation).toEqual([[s(translations[1])], [s(translations[0])]]);
        expect(result.digestTranslation).toEqual([[s(translations[0]), s(translations[1])]]);
        expect(usage.calls).toBe(2);
    });

    it('should show nothing when the page has no text of its own', async () => {
        chat.mockReset().mockResolvedValueOnce(json({topic: 'society', sourcing: 'none', sentences: []}));
        expect((await extractArticle('Vidéo', {content: text, blocks: []}, {language: 'fr'})).passages).toEqual([]);
    });

    it('should translate passages in another language than their page', async () => {
        // a vietnam.vn page (17.10.2026): an English lead, its news in Vietnamese, the page told English
        const lead = 'FIFA President Gianni Infantino apologized for shortcomings in the consultation process for the controversial '
            + 'commercial project. However, English and German football leaders are still demanding clarification on governance issues. ';
        const vietnamese = ['Dù vậy, lời xin lỗi chưa thuyết phục được một số quan chức Châu Âu về khả năng tiếp tục lãnh đạo của ông.',
            'Tuy nhiên, dự án đã bị dừng lại sau khi vấp phải phản đối.',
            'Infantino nhận trách nhiệm về những thiếu sót trong quá trình trao đổi và tham vấn.',
            'Ông nhấn mạnh FFE mới chỉ là đề xuất, chưa phải quyết định cuối cùng.'];
        const translations = ['However, the apology did not convince some European officials about his continued leadership.',
            'However, the project was halted after facing opposition.',
            'Infantino took responsibility for the shortcomings in the communication and consultation process.',
            'He stressed that the FFE was only a proposal, not a final decision.'];
        chat.mockReset()
            .mockResolvedValueOnce(json({topic: 'sport', sourcing: 'named', sentences: [5, 6, 7, 8]}))
            .mockResolvedValueOnce(json({translations}));
        const result = await extractArticle('Lãnh đạo bóng đá Anh và Đức chưa hài lòng',
            {content: `${lead.repeat(2)}${vietnamese.join(' ')}`, blocks: []}, {language: 'en'});
        expect(result.passages).toEqual([vietnamese.map(sentence => s(sentence))]);
        expect(result.from).toBe('vi');
        expect(result.translation).toEqual([translations.map(sentence => s(sentence))]);
        expect(chat.mock.calls[1][0].messages.at(-1).content).toContain('from Vietnamese into English');
    });
});

describe('canSummarize', () => {
    it('should not read the first lines of a page as the news', () => {
        expect(canSummarize('mot '.repeat(45))).toBe(false);
        expect(canSummarize(null)).toBe(false);
        expect(canSummarize('mot '.repeat(60))).toBe(true);
    });
});

describe('withoutDateline', () => {
    it('should take the date and the dash off the start of the first sentence of an article (the key points of a card of 6.11.2026 began with "November 6 –")', () => {
        const sentence = 'FIFA wants the IOC to restrict the women’s Olympic football tournament to under-23 players.';
        expect(withoutDateline(`November 6 – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`6 November 2026 — ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`Zurich, 27 October 2026 —- ${sentence}`.replace('—-', '—'))).toBe(sentence);
        expect(withoutDateline(`6 de noviembre – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`6 février - ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`06.11.2026 - ${sentence}`)).toBe(sentence);
    });

    it('should take off the other ways an agency writes it: a day of the week, a year with "de", a time', () => {
        const sentence = 'FIFA wants the IOC to restrict the women’s Olympic football tournament to under-23 players.';
        expect(withoutDateline(`Wednesday 6 November – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`Mercredi 6 novembre 2026 – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`Miércoles, 6 de noviembre de 2026 — ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`Mittwoch, 6. November 2026, 14:30 – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`Lima, 6 de noviembre – ${sentence}`)).toBe(sentence);
        expect(withoutDateline(`6 November 2026, 14h30 - ${sentence}`)).toBe(sentence);
    });

    it('should leave a sentence that is no dateline: no dash, a word that is no month, a range of dates, an opening figure', () => {
        expect(withoutDateline('November 6 was the day FIFA asked the IOC for it.')).toBe('November 6 was the day FIFA asked the IOC for it.');
        expect(withoutDateline('Smith 6 – Jones 4 was the score of the final.')).toBe('Smith 6 – Jones 4 was the score of the final.');
        expect(withoutDateline('November 6 – 8 November are the dates of the tournament.')).toBe('November 6 – 8 November are the dates of the tournament.');
        expect(withoutDateline('FIFA wants the IOC to restrict the tournament.')).toBe('FIFA wants the IOC to restrict the tournament.');
    });

    it('should only take it off the first sentence of an article: the date of a timeline is part of its line', () => {
        const content = 'November 6 – FIFA wants the IOC to restrict the tournament to under-23 players. March 5 – Police arrested the three men outside the stadium.';
        expect(splitSentences(content)).toEqual([
            'FIFA wants the IOC to restrict the tournament to under-23 players.',
            'March 5 – Police arrested the three men outside the stadium.',
        ]);
        expect(sentencesOf({content: '', blocks: [{kind: 'text', text: 'November 6 – FIFA wants the IOC to restrict the tournament to under-23 players.'}]}))
            .toEqual([{text: 'FIFA wants the IOC to restrict the tournament to under-23 players.', quote: false}]);
    });
});
