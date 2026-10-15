//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: test.briefing-analysis.js
//  Description: The analysis on top of a briefing: its lines cite their cards, a figure or a name no cited card
//               gives drops the line, gemma writes it when the reasoning model fails
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

// no tagger: the names are the words in capitals
process.env.NER_URL = '';
delete process.env.AISTUDIO_API_KEY;
const {ANALYSIS_MODEL, analysisOf, checkedLines} = await import('../../services/utils/briefing-analysis.js');

const cards = [
    {storyId: 11, title: 'SBB strike on Monday', summary: 'The SBB announced a strike of 24 hours on Monday. About 1,200 trains will not run.', lead: {source: 'rts.ch'}},
    {storyId: 12, title: 'FIFA Council to vote in March', summary: 'The FIFA Council will vote on 18 March in Rabat. Gianni Infantino seeks another term.', lead: {source: 'bbc.com'}},
];
const answer = (json) => ({message: {content: JSON.stringify(json)}, prompt_eval_count: 100, eval_count: 20});

beforeEach(() => chat.mockReset());

describe('the analysis of a briefing', () => {
    it('should keep the lines its cards support, citing their storyIds', async () => {
        const lines = await checkedLines({
            changed: [{cards: [1], text: 'The SBB strike for 24 hours on Monday: 1200 trains will not run.'}],
            risks: [{cards: [2], if: 'If the FIFA Council votes on 18 March,', then: 'then Infantino may get another term'}],
        }, cards);

        expect(lines.changed).toEqual([{text: 'The SBB strike for 24 hours on Monday: 1200 trains will not run.', storyIds: [11]}]);
        expect(lines.risks).toEqual([{if: 'the FIFA Council votes on 18 March', then: 'Infantino may get another term', storyIds: [12]}]);
        expect(lines.dropped).toBe(0);
    });

    it('should drop a line citing no card, a figure or a name its cards do not give', async () => {
        const lines = await checkedLines({
            changed: [{cards: [], text: 'A strike on Monday.'}, {cards: [1], text: 'The SBB strike for 48 hours.'}, {cards: [9], text: 'Nothing.'}],
            risks: [{cards: [2], if: 'the outages of Isaias persist', then: 'the vote is delayed'}],
        }, cards);

        expect(lines).toEqual({changed: [], risks: [], dropped: 4});
    });

    it('should be written by the reasoning model, in the reader language', async () => {
        chat.mockResolvedValueOnce(answer({changed: [{cards: [1], text: 'Les SBB font grève 24 heures lundi.'}], risks: []}));

        const analysis = await analysisOf(cards, 'fr');

        expect(analysis).toEqual({status: 'ready', model: ANALYSIS_MODEL, changed: [{text: 'Les SBB font grève 24 heures lundi.', storyIds: [11]}], risks: [], dropped: 0});
        expect(chat.mock.calls[0][0]).toMatchObject({model: ANALYSIS_MODEL, think: true});
        expect(chat.mock.calls[0][0].messages[0].content).toContain('in French');
    });

    it('should be written by gemma when the reasoning model fails', async () => {
        chat.mockRejectedValueOnce(Object.assign(new Error('down'), {status_code: 503}))
            .mockResolvedValueOnce(answer({changed: [{cards: [2], text: 'The FIFA Council votes on 18 March.'}], risks: []}));

        const analysis = await analysisOf(cards, 'en');

        expect(analysis.model).toBe('gemma4:31b');
        expect(analysis.changed).toEqual([{text: 'The FIFA Council votes on 18 March.', storyIds: [12]}]);
        expect(chat.mock.calls[1][0].model).not.toBe(ANALYSIS_MODEL);
    });

    it('should not be asked without a card to write from', async () => {
        expect(await analysisOf([{storyId: 1, title: 'A video', summary: null}], 'en')).toBeNull();
        expect(chat).not.toHaveBeenCalled();
    });
});
