//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: test.card-analysis.js
//  Description: The analysis of the cards that merit one: the cards picked without reasoning, each written with
//               reasoning from its own sources, a line kept only when its cited sources give its figures and
//               names, shown without ids nor "If"/"then", no other model when deepseek fails
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));

// no tagger: the names are the words in capitals; no Gemini
process.env.NER_URL = '';
delete process.env.AISTUDIO_API_KEY;
const {ANALYSIS_MODEL, MAX_ANALYSED, analysesOf, checkedLines, fittedArticles, pickedCards} = await import('../../services/utils/card-analysis.js');

const card = (n, storyId, extra = {}) => ({
    n, storyId, title: `Card ${n}`, titleTranslation: null, medium: 'rts.ch', summary: 'The FIFA Council will vote on 18 March in Rabat.',
    translation: null,
    articles: [
        {source: 'rts.ch', title: 'FIFA Council to vote', publishedAt: '2026-10-14T10:00:00Z',
            sentences: ['The FIFA Council will vote on 18 March in Rabat.', 'Gianni Infantino seeks another term, the BBC says.', 'A rival needs five nominations.']},
        {source: 'goal.com', title: 'Infantino under pressure', publishedAt: '2026-10-14T12:00:00Z',
            sentences: ['UEFA says the plan of Infantino lacks support.', 'If the Council refuses, the plan is dropped.', 'Clubs wait for the decision.']},
    ],
    timeline: {days: 2, items: [{date: '2026-10-12', title: 'Wenger may run for FIFA president', medium: 'eurosport.fr'}]},
    angles: [], contested: [], official: [],
    ...extra,
});
const answer = (json) => ({message: {content: JSON.stringify(json)}, prompt_eval_count: 100, eval_count: 20});

beforeEach(() => chat.mockReset());

describe('the lines of a card analysis', () => {
    it('should keep a line its cited sources support, shown without ids nor "If" and "then"', async () => {
        const lines = await checkedLines({
            why: [{text: 'According to A2, UEFA says the plan of Infantino lacks support (A2 s1).', cites: ['A2 s1']}],
            next: [{if: 'If the Council refuses,', then: 'then the plan is dropped.', cites: ['[A2 s2]']}],
        }, card(1, 11));

        expect(lines).toEqual({why: ['According to goal.com, UEFA says the plan of Infantino lacks support.'],
            next: [{if: 'the Council refuses', then: 'the plan is dropped.'}], dropped: 0});
    });

    it('should drop a line citing no source, or with a figure or a name its cited sources do not give', async () => {
        const lines = await checkedLines({
            why: [{text: 'The vote is on 18 March.', cites: []}, {text: 'A rival needs 106 votes.', cites: ['A1 s3']}],
            next: [{if: 'the outages of Isaias persist', then: 'the vote is delayed', cites: ['A1 s1']}],
        }, card(1, 11));

        expect(lines).toEqual({why: [], next: [], dropped: 3});
    });

    it('should let one name pass that another source of the card gives, and read a cited sentence with its whole article', async () => {
        const lines = await checkedLines({
            // UEFA is in article 2 only; Infantino in sentence 2 of article 1, not the one cited
            why: [{text: 'UEFA doubts the plan before the vote on 18 March.', cites: ['A1 s1']},
                {text: 'Infantino seeks another term before the vote.', cites: ['A1 s1']}],
        }, card(1, 11));

        expect(lines.why).toEqual(['UEFA doubts the plan before the vote on 18 March.', 'Infantino seeks another term before the vote.']);
    });

    it('should keep two "why" lines and two "next" lines at most', async () => {
        const lines = await checkedLines({
            why: [1, 2, 3].map(() => ({text: 'The Council will vote.', cites: ['A1 s1']})),
            next: [1, 2, 3].map(() => ({if: 'the Council refuses', then: 'the plan is dropped', cites: ['A2 s2']})),
        }, card(1, 11));

        expect([lines.why.length, lines.next.length]).toEqual([2, 2]);
    });
});

describe('the articles a card analysis reads', () => {
    it('should keep the lead first and cut the others to fit', () => {
        const long = (n) => Array.from({length: n}, (_, i) => `Sentence ${i} of an article that is long enough to count.`);
        const articles = fittedArticles([{source: 'a', sentences: long(300)}, {source: 'b', sentences: long(300)}, {source: 'c', sentences: long(300)}]);

        expect(articles.map(article => article.source)).toEqual(['a', 'b', 'c']);
        const chars = articles.map(article => article.sentences.join(' ').length);
        expect(chars[0]).toBeGreaterThanOrEqual(5500);
        expect(chars.slice(1).every(n => n <= 3000)).toBe(true);
        expect(chars.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12600);
    });
});

describe('the analyses of a briefing', () => {
    it('should pick the cards without reasoning, then write each with reasoning, in the reader language', async () => {
        chat.mockImplementation(async ({messages}) => messages[0].content.startsWith('You choose which cards')
            ? answer({cards: [{n: 2, reason: 'a vote to come'}, {n: 9, reason: 'no such card'}]})
            : answer({why: [{text: 'Selon goal.com, l’UEFA doute du plan d’Infantino.', cites: ['A2 s1']}], next: []}));
        const onPicked = jest.fn(async () => {});

        const result = await analysesOf([card(1, 11), card(2, 12)], 'fr', {onPicked});

        expect(onPicked).toHaveBeenCalledWith([{storyId: 12, reason: 'a vote to come'}]);
        expect(result).toEqual({picked: [{storyId: 12, reason: 'a vote to come'}],
            cards: {12: {why: ['Selon goal.com, l’UEFA doute du plan d’Infantino.'], next: [], dropped: 0}}});
        const [triage, analysis] = chat.mock.calls.map(([request]) => request);
        expect(triage).toMatchObject({model: ANALYSIS_MODEL, think: false});
        expect(analysis).toMatchObject({model: ANALYSIS_MODEL, think: true});
        expect(analysis.messages[0].content).toContain('for one reader, in French');
        expect(analysis.messages[0].content).toContain('T1 2026-10-12 eurosport.fr: Wenger may run for FIFA president');
    });

    it('should keep the cards that merit an analysis most, in the order the AI ranks them', async () => {
        chat.mockResolvedValueOnce(answer({cards: [9, 3, 1, 8, 2, 7, 5, 4].map(n => ({n, reason: `card ${n}`}))}));
        const cards = Array.from({length: 9}, (_, i) => card(i + 1, 100 + i));

        const picked = await pickedCards(cards, 'en');

        expect(MAX_ANALYSED).toBe(6);
        expect(picked.map(entry => entry.n)).toEqual([9, 3, 1, 8, 2, 7]);
        expect(chat.mock.calls[0][0].messages[0].content).toContain('from the one that merits an analysis most');
    });

    it('should give a card no analysis when deepseek fails on it, no other model asked', async () => {
        chat.mockImplementation(async ({messages}) => {
            if (messages[0].content.startsWith('You choose which cards')) return answer({cards: [{n: 1}]});
            throw Object.assign(new Error('down'), {status_code: 503});
        });

        const result = await analysesOf([card(1, 11)], 'en');

        expect(result).toEqual({picked: [{storyId: 11, reason: null}], cards: {}});
        expect(chat.mock.calls.every(([request]) => request.model === ANALYSIS_MODEL)).toBe(true);
    });
});
