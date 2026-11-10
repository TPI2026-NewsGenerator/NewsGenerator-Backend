//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: test.neutral-titles.js
//  Description: The title of a card without the bait of its medium: the AI says which teaser to take out, the code
//               takes out only a whole sentence apart from the rest, never a fact, a name, a figure, a negation or
//               a quotation, and leaves the title as it was when too little would be left
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson}));
const {aiRewrittenTitles, bestRewrite, checkRewrite, judgedTitles, judgmentPrompt, neutralTitle, neutralTitles, normalizeJudged, normalizeRemovals, normalizeSameFact, neutralPrompt, rewritePrompt, rewrittenTitle, sameFact, sameFactPrompt} = await import('../../services/utils/neutral-titles.js');

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

describe('checkRewrite', () => {
    const passages = 'Le PSG a gagné 3-0 à Lyon dimanche. Mbappé a marqué deux buts.';

    it('should accept a proposal that keeps the names, the figures and the quotations', () => {
        expect(checkRewrite('Incroyable ! Le PSG écrase Lyon 3-0', 'Le PSG bat Lyon 3-0', passages)).toEqual({text: 'Le PSG bat Lyon 3-0'});
        expect(checkRewrite('Mbappé: "On a été énormes !"', 'Mbappé: "On a été énormes"', passages)).toEqual({text: 'Mbappé: "On a été énormes"'});
    });

    it('should accept a title that is itself in quotation marks, and unwrap a proposal the AI put in some', () => {
        expect(checkRewrite('"On a gagné": Mbappé après Lyon', '"On a gagné": Mbappé après Lyon', passages).text).toBe('"On a gagné": Mbappé après Lyon');
        expect(checkRewrite('Incroyable ! Le PSG bat Lyon 3-0', '"Le PSG bat Lyon 3-0"', passages)).toEqual({text: 'Le PSG bat Lyon 3-0'});
    });

    it('should refuse a name or a figure that neither the title nor the passages have', () => {
        expect(checkRewrite('Incroyable ! Le PSG bat Lyon', 'Neymar et le PSG battent Lyon', passages)).toEqual({problem: 'name added'});
        expect(checkRewrite('Incroyable ! Le PSG bat Lyon', 'Le PSG bat Lyon 5-0', passages)).toEqual({problem: 'figure added'});
        expect(checkRewrite('Le PSG bat Lyon 3-0 devant 40 000 fans', 'Le PSG bat Lyon 3-0', passages)).toEqual({problem: 'figure lost'});
    });

    it('should refuse a proposal that loses a name of the title', () => {
        expect(checkRewrite('Incroyable ! Le PSG et Mbappé battent Lyon', 'Le PSG bat Lyon', passages)).toEqual({problem: 'name lost'});
        // a name written longer keeps its beginning
        expect(checkRewrite('Real attacks Barca before the Clasico', 'Real criticises Barcelona before the Clasico', 'Barcelona').text).toBeDefined();
    });

    it('should refuse a negation added or lost, and a question made a statement', () => {
        expect(checkRewrite('Le PSG ne bat pas Lyon', 'Le PSG bat Lyon', passages)).toEqual({problem: 'negation'});
        expect(checkRewrite('Morocco will organise the next Club World Cup?', 'Morocco may organise the next Club World Cup', '')).toEqual({problem: 'question'});
    });

    it('should refuse a quotation that is not word for word, and an exclamation mark kept', () => {
        expect(checkRewrite('Mbappé: "On a été énormes ce soir"', 'Mbappé: "On a été bons"', passages)).toEqual({problem: 'quotation changed'});
        expect(checkRewrite('Incroyable ! Le PSG bat Lyon', 'Le PSG bat Lyon !', passages)).toEqual({problem: 'exclamation'});
    });

    it('should refuse an empty proposal and one far from the title in length', () => {
        expect(checkRewrite('Le PSG bat Lyon', '', passages)).toEqual({problem: 'empty'});
        expect(checkRewrite('Le PSG bat Lyon', null, passages)).toEqual({problem: 'empty'});
        expect(checkRewrite('Le PSG bat Lyon', 'Le PSG bat Lyon à Lyon dimanche soir devant tout le monde', passages)).toEqual({problem: 'length'});
        expect(checkRewrite('Le PSG bat Lyon après un match très long et très disputé', 'Le PSG bat Lyon', passages)).toEqual({problem: 'length'});
    });

    it('should not take the words of a title in title case for names', () => {
        expect(checkRewrite('Friendship Allstar Crowned EBFA U-17 Youth Ensemble Champions', 'Friendship Allstar wins EBFA U-17 Youth Ensemble', '').text)
            .toBe('Friendship Allstar wins EBFA U-17 Youth Ensemble');
    });

    it('should not take the first word after a full stop or an exclamation mark for a name', () => {
        expect(checkRewrite('Judges named in Europe! Here is where they judge', 'Judges named in Europe', '').text).toBe('Judges named in Europe');
    });
});

describe('checkRewrite of an injunction of the medium', () => {
    const title = 'Total debacle for the hockey federation: nobody wants to be president of the Hockey Federation of Norway, IIHF and the IOC must react';

    it('should let the names of the last clause go when the proposal leaves that clause out whole, and say which clause', () => {
        expect(checkRewrite(title, 'Nobody wants to be president of the Hockey Federation of Norway', '')).toEqual({
            text: 'Nobody wants to be president of the Hockey Federation of Norway',
            dropped: ['IIHF and the IOC must react'],
        });
    });

    it('should let a clause at the start go with the last one, and not count the clauses left out in what the proposal must keep', () => {
        // 16 words, the proposal has 6: less than 0.4 of the title, more than 0.4 of the 7 words that are left
        expect(checkRewrite('Katastrofe for norsk håndball: Ingen vil bli president i forbundet NHF, IHF og IOC må reagere', 'Ingen vil bli president i NHF', '')).toEqual({
            text: 'Ingen vil bli president i NHF',
            dropped: ['Katastrofe for norsk håndball', 'IHF og IOC må reagere'],
        });
        // a title with nothing to leave out is held to the whole of its length as before
        expect(checkRewrite('Le PSG bat Lyon après un match très long et très disputé', 'Le PSG bat Lyon', '')).toEqual({problem: 'length'});
    });

    it('should still refuse a name lost with the clause that starts the title: it says a fact', () => {
        expect(checkRewrite('Infantino under pressure from UEFA: FIFA opens the file of the project', 'FIFA opens the file of the project', '')).toEqual({problem: 'name lost'});
        expect(checkRewrite('UEFA and FIFA must react: nobody wants to lead the Hockey Federation of Norway', 'Nobody wants to lead the Hockey Federation of Norway', '')).toEqual({problem: 'name lost'});
    });

    it('should still refuse a name lost with a clause that the proposal keeps some of', () => {
        expect(checkRewrite('Total debacle: nobody wants to lead the Hockey Federation, IIHF and the IOC must react', 'Nobody wants to lead the Hockey Federation, IIHF reacts', ''))
            .toEqual({problem: 'name lost'});
    });

    it('should still refuse a name lost with a clause in the middle of the title, or one of more than ten words', () => {
        expect(checkRewrite('Nobody wants to lead the Hockey Federation, IIHF must react, a vote is planned', 'Nobody wants to lead the Hockey Federation, a vote is planned', ''))
            .toEqual({problem: 'name lost'});
        expect(checkRewrite('Total debacle: nobody wants the job at the Hockey Federation, the IOC must react at once and the IIHF and the leagues of Norway and Sweden must follow',
            'Nobody wants the job at the Hockey Federation', '')).toEqual({problem: 'name lost'});
    });

    it('should still refuse a figure, a negation or a quotation lost with the clause', () => {
        expect(checkRewrite('Total debacle: nobody wants the job at the Hockey Federation, 12 clubs and the IOC must react', 'Nobody wants the job at the Hockey Federation', ''))
            .toEqual({problem: 'figure lost'});
        // the title keeps another negation (« nobody »), so the one in the clause left out is looked for in the clause
        expect(checkRewrite('Total debacle: nobody wants the job at the Hockey Federation, IIHF must not react', 'Nobody wants the job at the Hockey Federation', ''))
            .toEqual({problem: 'name lost'});
        expect(checkRewrite('Total debacle: nobody wants the job at the Hockey Federation, Coach Berg said "IIHF must react"', 'Nobody wants the job at the Hockey Federation', ''))
            .toEqual({problem: 'quotation changed'});
    });

    it('should not say what is left out when no name goes with it', () => {
        expect(checkRewrite('Incroyable ! Le PSG écrase Lyon 3-0', 'Le PSG bat Lyon 3-0', 'Lyon')).toEqual({text: 'Le PSG bat Lyon 3-0'});
    });
});

describe('checkRewrite of a quotation', () => {
    it('should refuse a quotation that loses its quotation marks: it would be the medium that says it', () => {
        const title = '"No club should be excluded from the league", the president says';
        expect(checkRewrite(title, 'No club should be excluded from the league, the president says', '')).toEqual({problem: 'quotation changed'});
        expect(checkRewrite(title, '“No club should be excluded from the league”, the president says', '').text).toBe('“No club should be excluded from the league”, the president says');
        expect(checkRewrite('"No club should be excluded from the league"', 'No club should be excluded from the league', '')).toEqual({problem: 'quotation changed'});
    });
});

describe('rewrittenTitle', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should answer the proposal when it is checked, and ask in the language of the title', async () => {
        ollamaJson.mockResolvedValue({title: 'Le PSG bat Lyon 3-0'});
        expect(await rewrittenTitle('Incroyable ! Le PSG écrase Lyon 3-0', 'Le PSG a gagné 3-0.', null, {language: 'French'})).toEqual({title: 'Le PSG bat Lyon 3-0'});
        expect(ollamaJson.mock.calls[0][0]).toBe(rewritePrompt('Incroyable ! Le PSG écrase Lyon 3-0', 'Le PSG a gagné 3-0.', 'French'));
        expect(ollamaJson.mock.calls[0][0]).toContain('(French, pas en français)');
    });

    it('should answer the clauses left out with their names, for the second opinion', async () => {
        ollamaJson.mockResolvedValue({title: 'Nobody wants to be president of the Hockey Federation of Norway'});
        expect(await rewrittenTitle('Total debacle for the hockey federation: nobody wants to be president of the Hockey Federation of Norway, IIHF and the IOC must react', ''))
            .toEqual({title: 'Nobody wants to be president of the Hockey Federation of Norway', dropped: ['IIHF and the IOC must react']});
    });

    it('should answer that a title is neutral already when the AI gives it back', async () => {
        ollamaJson.mockResolvedValue({title: 'Le PSG bat Lyon 3-0'});
        expect(await rewrittenTitle('Le PSG bat Lyon 3-0', '')).toEqual({title: null, reason: 'same'});
    });

    it('should show no proposal that changes what the title says, and say why for the logs', async () => {
        ollamaJson.mockResolvedValue({title: 'Neymar bat Lyon 3-0'});
        expect(await rewrittenTitle('Le PSG bat Lyon 3-0', '')).toEqual({title: null, reason: 'unsafe', problem: 'name added', proposal: 'Neymar bat Lyon 3-0'});
    });

    it('should let the error of the AI through: the reader is told, the card is not touched', async () => {
        ollamaJson.mockRejectedValue(new Error('down'));
        await expect(rewrittenTitle('Le PSG bat Lyon 3-0', '')).rejects.toThrow('down');
    });
});

describe('bestRewrite', () => {
    beforeEach(() => ollamaJson.mockReset());
    // the first card of a briefing of 6.11.2026: the proposal lost the "FA" of its first clause, the checks refused it three times of three
    const TITLE = 'Now will the FA put their money where their mouth is? England chiefs and UEFA must decide whether to back rival Japanese bid to Gianni Infantino';

    it('should answer the first proposal that passes the checks, asking once', async () => {
        ollamaJson.mockResolvedValue({title: 'England chiefs and UEFA must decide whether to back rival Japanese bid to Gianni Infantino'});
        expect((await bestRewrite(TITLE, '')).title).toBeNull();
        expect(ollamaJson).toHaveBeenCalledTimes(2);

        ollamaJson.mockReset().mockResolvedValue({title: 'Le PSG bat Lyon 3-0'});
        expect(await bestRewrite('Incroyable ! Le PSG écrase Lyon 3-0', '')).toEqual({title: 'Le PSG bat Lyon 3-0'});
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should answer that a title is neutral already without asking again', async () => {
        ollamaJson.mockResolvedValue({title: 'Le PSG bat Lyon 3-0'});
        expect(await bestRewrite('Le PSG bat Lyon 3-0', '')).toEqual({title: null, reason: 'same'});
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });

    it('should answer the refused proposal that can mislead the least, with what the checks found, for the reader to read', async () => {
        // a figure lost, then a name lost: the name is the lighter
        ollamaJson.mockResolvedValueOnce({title: 'The FA decides'}).mockResolvedValueOnce({title: 'England chiefs and UEFA must decide whether to back rival Japanese bid to Gianni Infantino'});
        const answer = await bestRewrite('Now will the FA decide whether to back 2 rival bids to Gianni Infantino?', '');
        expect(answer.reason).toBe('unsafe');
        expect(answer.proposal).toBeTruthy();

        ollamaJson.mockReset().mockResolvedValue({title: 'England chiefs and UEFA must decide whether to back rival Japanese bid to Gianni Infantino'});
        expect(await bestRewrite(TITLE, '')).toEqual({title: null, reason: 'unsafe', problem: 'name lost', proposal: 'England chiefs and UEFA must decide whether to back rival Japanese bid to Gianni Infantino'});
    });

    it('should ask again when the AI fails once, and let the error through when it fails every time', async () => {
        ollamaJson.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({title: 'Le PSG bat Lyon 3-0'});
        expect(await bestRewrite('Incroyable ! Le PSG écrase Lyon 3-0', '')).toEqual({title: 'Le PSG bat Lyon 3-0'});

        ollamaJson.mockReset().mockRejectedValue(new Error('down'));
        await expect(bestRewrite('Le PSG bat Lyon 3-0', '')).rejects.toThrow('down');
    });
});

describe('rewrittenTitle of a short title', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should answer that a title of two words is neutral already when the AI gives it back', async () => {
        ollamaJson.mockResolvedValue({title: 'Infantino’s Advantage'});
        expect(await rewrittenTitle('Infantino’s Advantage', '')).toEqual({title: null, reason: 'same'});
    });
});

describe('judgedTitles', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should read the titles that have a judgment, each once, with the words in cause', () => {
        const answer = {titles: [{n: 2, words: [' incroyable ', 4, '']}, {n: '[3]', words: 'no'}, {n: 9, words: ['x']}, {n: 2, words: ['again']}, null]};
        expect([...normalizeJudged(answer, 3)]).toEqual([[1, ['incroyable']], [2, []]]);
        expect(normalizeJudged(null, 3).size).toBe(0);
    });

    it('should ask the AI once for all the titles, and nothing for none', async () => {
        ollamaJson.mockResolvedValue({titles: [{n: 1, words: ['Incroyable !']}]});
        expect([...await judgedTitles(['Incroyable ! Le PSG gagne', 'Le PSG gagne'])]).toEqual([[0, ['Incroyable !']]]);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
        expect((await judgedTitles([])).size).toBe(0);
        expect(ollamaJson).toHaveBeenCalledTimes(1);
    });
});

describe('judgmentPrompt and rewritePrompt', () => {
    it('should ask for the nouns that judge and the injunctions of the medium, not for a rule stated as a fact', () => {
        for (const prompt of [judgmentPrompt(['Titre']), rewritePrompt('Titre', '')]) {
            expect(prompt).toContain('fiasco');
            expect(prompt).toContain('INJONCTION');
            expect(prompt).toContain('Players must wear shin guards');
        }
    });
});

describe('sameFact', () => {
    beforeEach(() => ollamaJson.mockReset());

    it('should tell the second opinion what was left out of a pair, when something was', () => {
        const prompt = sameFactPrompt([{title: 'A1', proposal: 'B1', dropped: ['IIHF must react', 'Total debacle']}, {title: 'A2', proposal: 'B2'}, {title: 'A3', proposal: 'B3', dropped: []}]);
        expect(prompt).toContain('[1]\nA : A1\nB : B1\nRetiré : IIHF must react / Total debacle\n');
        expect(prompt).toContain('[2]\nA : A2\nB : B2\n');
        expect(prompt).toContain('[3]\nA : A3\nB : B3\n');
        expect(prompt.match(/Retiré :/g)).toHaveLength(1);
    });

    it('should read the verdict of each pair, a pair without a clear one left out', () => {
        const answer = {pairs: [{n: 1, same: true, why: ''}, {n: '[2]', same: false, why: ' reacts is not announces '}, {n: 3, same: 'yes'}, {n: 9, same: true}, {n: 1, same: false}]};
        expect([...normalizeSameFact(answer, 3)]).toEqual([[0, {same: true, why: ''}], [1, {same: false, why: 'reacts is not announces'}]]);
        expect(normalizeSameFact(undefined, 3).size).toBe(0);
    });

    it('should ask for the same MAIN fact in the loose prompt: the judgment, a detail and a nuance may go, the main fact may not, a doubt keeps the rewrite', () => {
        const pairs = [{title: 'A1', proposal: 'B1', dropped: ['Total debacle']}, {title: 'A2', proposal: 'B2'}];
        const loose = sameFactPrompt(pairs, {loose: true});
        expect(loose).toContain('MÊME FAIT PRINCIPAL');
        expect(loose).toContain('Dans le doute, oui si le fait principal est le même.');
        expect(loose).not.toContain('EXACTEMENT');
        expect(loose).toContain('[1]\nA : A1\nB : B1\nRetiré : Total debacle\n');
        expect(loose).toContain('[2]\nA : A2\nB : B2\n');
        // the strict one is still there, and the default of the function
        expect(sameFactPrompt(pairs, {loose: false})).toContain('EXACTEMENT le même fait');
        expect(sameFactPrompt(pairs)).toBe(sameFactPrompt(pairs, {loose: false}));
        expect(sameFactPrompt(pairs)).toContain('Dans le doute, non.');
    });

    it('should ask the loose question when asked to, with the same answer rules', async () => {
        ollamaJson.mockResolvedValue({pairs: [{n: 1, same: true}]});
        const pairs = [{title: 'A new dawn? Kenya launch ambitious strategy', proposal: 'Kenya launch strategy'}];
        expect([...await sameFact(pairs, null, {think: true, loose: true})]).toEqual([[0, {same: true, why: ''}]]);
        expect(ollamaJson.mock.calls[0][0]).toBe(sameFactPrompt(pairs, {loose: true}));
    });

    it('should ask the AI once for all the pairs, with thinking as asked', async () => {
        ollamaJson.mockResolvedValue({pairs: [{n: 1, same: true}]});
        const pairs = [{title: 'Incroyable ! Le PSG gagne', proposal: 'Le PSG gagne'}];
        expect([...await sameFact(pairs, null, {think: true})]).toEqual([[0, {same: true, why: ''}]]);
        expect(ollamaJson.mock.calls[0][0]).toBe(sameFactPrompt(pairs));
        expect(ollamaJson.mock.calls[0][2]).toEqual({think: true});
        expect((await sameFact([])).size).toBe(0);
    });
});

describe('aiRewrittenTitles', () => {
    beforeEach(() => {
        ollamaJson.mockReset();
        delete process.env.AI_NEUTRAL_TITLES;
    });
    const entries = [
        {title: 'Historic: from this matchday onwards referees will speak', passages: 'Referees speak after matches.', language: 'English'},
        {title: 'Le PSG bat Lyon 3-0', passages: '', language: 'French'},
        {title: 'New scandal shakes FIFA', passages: 'Allegations were made against FIFA.', language: 'English'},
    ];
    // the AI by the prompt it is given: which titles are judged, what each one is rewritten into, what the second opinion says
    const answers = ({rewrites, verdicts}) => async (prompt) => {
        if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Historic']}, {n: 3, words: ['shakes']}]};
        if (prompt.startsWith('Voici le titre')) return {title: rewrites[prompt.match(/Titre : (.*)/)[1]]};
        return {pairs: verdicts.map((same, i) => ({n: i + 1, same}))};
    };

    it('should keep the rewrites the second opinion says tell the same fact, and only the titles judged', async () => {
        ollamaJson.mockImplementation(answers({
            rewrites: {'Historic: from this matchday onwards referees will speak': 'From this matchday onwards referees will speak', 'New scandal shakes FIFA': 'New allegations against FIFA'},
            verdicts: [true, false],
        }));
        const kept = await aiRewrittenTitles(entries, {});
        expect([...kept]).toEqual([[0, 'From this matchday onwards referees will speak']]);
        // one call to judge the three titles, one to rewrite each one judged, one to give a second opinion on both, thinking on
        expect(ollamaJson).toHaveBeenCalledTimes(4);
        const opinion = ollamaJson.mock.calls.find(([prompt]) => prompt.startsWith('Voici des paires'));
        expect(opinion[2].think).toBe(true);
        expect(ollamaJson.mock.calls.filter(([prompt]) => prompt.startsWith('Voici le titre')).every(([, , options]) => options.think === true)).toBe(true);
    });

    it('should ask the second opinion for the main fact by default (10.11.2026), the strict one with NEUTRAL_TITLES_CHECK=strict', async () => {
        const rewrites = {'Historic: from this matchday onwards referees will speak': 'From this matchday onwards referees will speak', 'New scandal shakes FIFA': 'New allegations against FIFA'};
        ollamaJson.mockImplementation(answers({rewrites, verdicts: [true, true]}));
        expect((await aiRewrittenTitles(entries, {})).size).toBe(2);
        expect(ollamaJson.mock.calls.find(([prompt]) => prompt.startsWith('Voici des paires'))[0]).toContain('MÊME FAIT PRINCIPAL');
        ollamaJson.mockClear();
        process.env.NEUTRAL_TITLES_CHECK = 'strict';
        try {
            expect((await aiRewrittenTitles(entries, {})).size).toBe(2);
            expect(ollamaJson.mock.calls.find(([prompt]) => prompt.startsWith('Voici des paires'))[0]).toContain('EXACTEMENT le même fait');
        } finally {
            delete process.env.NEUTRAL_TITLES_CHECK;
        }
    });

    it('should tell the second opinion which clause a rewrite left out with its names', async () => {
        const title = 'Total debacle for the hockey federation: nobody wants to be president of the Hockey Federation of Norway, IIHF and the IOC must react';
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Total debacle', 'must react']}]};
            if (prompt.startsWith('Voici le titre')) return {title: 'Nobody wants to be president of the Hockey Federation of Norway'};
            return {pairs: [{n: 1, same: true}]};
        });
        const kept = await aiRewrittenTitles([{title, passages: '', language: 'English'}], {});
        expect([...kept]).toEqual([[0, 'Nobody wants to be president of the Hockey Federation of Norway']]);
        const opinion = ollamaJson.mock.calls.find(([prompt]) => prompt.startsWith('Voici des paires'))[0];
        expect(opinion).toContain('Retiré : IIHF and the IOC must react');
    });

    it('should give back in "proposed" what it did not keep: a rewrite the checks refuse and one the second opinion refuses, each with its reason', async () => {
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Historic']}, {n: 3, words: ['shakes']}]};
            if (prompt.startsWith('Voici le titre')) return {title: prompt.includes('Titre : New scandal') ? 'New scandal shakes FIFA!' : 'From this matchday onwards referees will speak'};
            return {pairs: [{n: 1, same: false, why: 'it loses who speaks'}]};
        });
        const proposed = new Map();
        expect((await aiRewrittenTitles(entries, {}, proposed)).size).toBe(0);
        expect([...proposed]).toEqual([
            [2, {title: 'New scandal shakes FIFA!', problem: 'exclamation'}],
            [0, {title: 'From this matchday onwards referees will speak', problem: 'second opinion', why: 'it loses who speaks'}],
        ].sort((a, b) => [...proposed.keys()].indexOf(a[0]) - [...proposed.keys()].indexOf(b[0])));
    });

    it('should keep nothing a rewrite refused by the checks of the code, nor ask a second opinion of it', async () => {
        ollamaJson.mockImplementation(answers({rewrites: {'Historic: from this matchday onwards referees will speak': 'Neymar: referees will speak', 'New scandal shakes FIFA': 'New scandal shakes FIFA!'}, verdicts: []}));
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);
        expect(ollamaJson.mock.calls.some(([prompt]) => prompt.startsWith('Voici des paires'))).toBe(false);
    });

    it('should leave the titles as they are when the AI fails at any step', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        ollamaJson.mockRejectedValue(new Error('down'));
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);

        // judged, but not rewritten
        ollamaJson.mockReset();
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Historic']}]};
            throw new Error('down');
        });
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);

        // rewritten, but the second opinion fails
        ollamaJson.mockReset();
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Historic']}]};
            if (prompt.startsWith('Voici le titre')) return {title: 'From this matchday onwards referees will speak'};
            throw new Error('down');
        });
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);
        error.mockRestore();
    });

    it('should keep only a rewrite the second opinion answered true to, none when it answers nothing clear', async () => {
        ollamaJson.mockImplementation(async (prompt) => {
            if (prompt.startsWith('Voici des titres')) return {titles: [{n: 1, words: ['Historic']}]};
            if (prompt.startsWith('Voici le titre')) return {title: 'From this matchday onwards referees will speak'};
            return {pairs: [{n: 1, same: 'yes'}]};
        });
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);
    });

    it('should ask nothing for no title, nor when it is turned off', async () => {
        expect((await aiRewrittenTitles([], {})).size).toBe(0);
        process.env.AI_NEUTRAL_TITLES = 'off';
        expect((await aiRewrittenTitles(entries, {})).size).toBe(0);
        expect(ollamaJson).not.toHaveBeenCalled();
    });
});
