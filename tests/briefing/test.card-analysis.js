//
//  Author: Fabian Rostello
//  Date: 15.10.2026
//  File: test.card-analysis.js
//  Description: The analysis of the cards that merit one: the cards picked without reasoning, each written with
//               reasoning from its own sources, a line kept only when its cited sources give its figures and
//               names, shown without ids nor "If"/"then", gpt-oss:120b when deepseek fails
//

import process from 'node:process';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
// the briefing service is read for its analysisOfRow only
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));

// no tagger: the names are the words in capitals; no Gemini
process.env.NER_URL = '';
delete process.env.AISTUDIO_API_KEY;
const {ANALYSIS_MODEL, analysesOf, capitalWordsOfCard, checkedLines, cleanNext, fittedArticles, lowerFirst, pickedCards, repeatsCard, withCleanNext} = await import('../../services/utils/card-analysis.js');

const {newUsage} = await import('../../services/utils/ollama.js');

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

describe('the "If X, then Y" lines of an analysis', () => {
    // the AI wrote the whole sentence in "if" and the consequence again in "then" (the user, 2.11.2026)
    const repeated = {
        if: 'FKF breaches these principles, then FIFA may refer the matter to its competent bodies for consideration of appropriate measures under the FIFA Statutes.',
        then: 'FIFA may refer the matter to its competent bodies for consideration of appropriate measures under the FIFA Statutes.',
    };
    const once = {if: 'FKF breaches these principles',
        then: 'FIFA may refer the matter to its competent bodies for consideration of appropriate measures under the FIFA Statutes.'};

    it('should stop the condition at its own "then", the consequence being the one of "then"', () => {
        expect(cleanNext(repeated)).toEqual(once);
        expect(cleanNext({if: 'If the Council refuses,', then: 'then the plan is dropped.'})).toEqual({if: 'the Council refuses', then: 'the plan is dropped.'});
    });

    it('should take the words after the "then" of the condition as the consequence when "then" is empty', () => {
        expect(cleanNext({if: 'the Council refuses, alors le plan est abandonné.', then: ''})).toEqual({if: 'the Council refuses', then: 'le plan est abandonné.'});
    });

    // the page writes "If X, then Y": a point the AI ended X with showed as ".," before the "then" (the user, 5.11.2026)
    it('should not end the condition with a point, nor a point and a comma, the page puts its own comma after it', () => {
        expect(cleanNext({if: 'the Council refuses.', then: 'the plan is dropped.'})).toEqual({if: 'the Council refuses', then: 'the plan is dropped.'});
        expect(cleanNext({if: 'If the Council refuses.,', then: 'the plan is dropped.'}).if).toBe('the Council refuses');
        expect(cleanNext({if: 'the Council refuses…', then: 'the plan is dropped.'}).if).toBe('the Council refuses…');
        // the consequence is a sentence of its own: its point stays
        expect(cleanNext({if: 'the Council refuses', then: 'the plan is dropped.'}).then).toBe('the plan is dropped.');
    });

    it('should keep the last point of an initialism ending the condition', () => {
        expect(cleanNext({if: 'talks with the U.S.', then: 'a deal is signed.'}).if).toBe('talks with the U.S.');
        expect(cleanNext({if: 'talks with the U.S.,', then: 'a deal is signed.'}).if).toBe('talks with the U.S.');
    });

    it('should clean a saved analysis whose condition ends with a point', () => {
        const saved = {status: 'ready', cards: {5: {why: [], next: [{if: 'the vote fails.', then: 'the plan is dropped.'}], timeline: []}}};
        expect(withCleanNext(saved).cards[5].next).toEqual([{if: 'the vote fails', then: 'the plan is dropped.'}]);
    });

    // the page writes "If" and "then": "If Talks open, then They would" has a capital where the sentence goes on (the user's friend, 6.11.2026)
    it('should begin the condition and the consequence with a small letter, the page writes the "If" and the "then" before them', () => {
        const saved = {cards: {1: {why: [], next: [
            {if: 'If Talks open,', then: 'then They would involve players and major associations.'},
            {if: 'A change is adopted', then: 'It could only apply from 2032.'},
        ]}}};
        expect(withCleanNext(saved).cards[1].next).toEqual([
            {if: 'talks open', then: 'they would involve players and major associations.'},
            {if: 'a change is adopted', then: 'it could only apply from 2032.'},
        ]);
    });

    it('should keep the capital of a name or a noun the card writes with one, of an acronym and of "I"', () => {
        const saved = {cards: {1: {why: [], next: [
            {if: 'Brazil win the final', then: 'FIFA may react.'},
            {if: 'Gespräche beginnen', then: 'McDonald zahlt.'},
            {if: 'I am asked', then: 'U-23 players are chosen.'},
        ]}}};
        const known = () => new Set(['brazil', 'gesprache']);
        expect(withCleanNext(saved, known).cards[1].next).toEqual([
            {if: 'Brazil win the final', then: 'FIFA may react.'},
            {if: 'Gespräche beginnen', then: 'McDonald zahlt.'},
            {if: 'I am asked', then: 'U-23 players are chosen.'},
        ]);
    });

    // found on the saved analyses of 6.11.2026: "If Kozo Tashima is supported" became "If kozo Tashima" (the card spells Kohzo)
    it('should keep the capital of a name the card spells otherwise: a word followed by another with a capital, but not after a determiner', () => {
        expect(lowerFirst('Kozo Tashima is supported by five federations')).toBe('Kozo Tashima is supported by five federations');
        expect(lowerFirst('Real Sociedad receive the answers')).toBe('Real Sociedad receive the answers');
        expect(lowerFirst('The CTA follows through on its commitment')).toBe('the CTA follows through on its commitment');
        expect(lowerFirst('Competing candidates complain to the Court')).toBe('competing candidates complain to the Court');
        expect(lowerFirst('Les Bleus gagnent')).toBe('les Bleus gagnent');
        expect(lowerFirst('Die Gespräche beginnen')).toBe('die Gespräche beginnen');
        expect(lowerFirst('Talks open')).toBe('talks open');
    });

    it('should find the names of a card in its text, in the middle of its sentences, and in the names it is tagged with', () => {
        const known = capitalWordsOfCard({title: 'FIFA pushes for the Olympic tournament', summary: 'Talks with Brazil open. The wait is long.', names: [{name: 'Infantino'}, 'Brisbane']});
        expect(known.has('brazil')).toBe(true);
        expect(known.has('infantino')).toBe(true);
        expect(known.has('brisbane')).toBe(true);
        expect(known.has('talks')).toBe(false);
        expect(lowerFirst('Brazil win', known)).toBe('Brazil win');
        expect(lowerFirst('Talks open', known)).toBe('talks open');
    });

    it('should leave a line as it is when its condition has no "then"', () => {
        expect(cleanNext(once)).toEqual(once);
    });

    it('should clean a line of an analysis saved with the repetition, and leave the rest', () => {
        const saved = {status: 'ready', model: 'm', cards: {12: {why: ['A.'], next: [repeated], timeline: []}, 13: {why: ['B.'], next: [], timeline: []}}};
        expect(withCleanNext(saved).cards[12].next).toEqual([once]);
        expect(withCleanNext(saved).cards[13]).toEqual(saved.cards[13]);
        expect(withCleanNext({status: 'running'})).toEqual({status: 'running'});
        expect(withCleanNext(null)).toBe(null);
    });

    it('should show a written line once, as checked', async () => {
        const lines = await checkedLines({next: [{...repeated, if: 'If the Council refuses, then the plan is dropped.', then: 'the plan is dropped.', cites: ['A2 s2']}]}, card(1, 11));
        expect(lines.next).toEqual([{if: 'the Council refuses', then: 'the plan is dropped.'}]);
    });
});

describe('a "why" line that says again what the card shows', () => {
    const shown = card(1, 11, {
        title: 'City appeal against 114 upheld charges', titleTranslation: null,
        summary: 'An independent commission upheld 114 of 115 Premier League charges against Manchester City for financial breaches from 2009-10 to 2017-18.',
    });

    it('should tell a line whose words are in the title and the key passages of the card', () => {
        // the line of the judged data that was no use: the key passage, as it stands
        expect(repeatsCard('An independent commission upheld 114 of 115 Premier League charges against Manchester City for financial breaches.', shown)).toBe(true);
        // its words, other ones around them
        expect(repeatsCard('Premier League charges against Manchester City were upheld by an independent commission for financial breaches in 2009-10.', shown)).toBe(true);
    });

    it('should keep a line that tells more than the card, a short one, and a line of an empty card', () => {
        expect(repeatsCard('The league boss calls the case a warning to every club about hiding the money of an owner, and a sanction of nine years is asked.', shown)).toBe(false);
        expect(repeatsCard('An independent commission upheld the charges.', shown)).toBe(false);
        expect(repeatsCard('An independent commission upheld 114 of 115 Premier League charges against Manchester City.', {title: 'Other', summary: ''})).toBe(false);
    });

    it('should read the title and the passages in the language of the reader', () => {
        const french = card(1, 11, {title: 'Zetchi', titleTranslation: 'Le procès de Zetchi s’ouvre', summary: 'Le procès s’ouvre après six reports et près de deux ans de détention provisoire pour Zetchi.',
            translation: 'Le procès s’ouvre après six reports et près de deux ans de détention provisoire pour Zetchi.'});
        expect(repeatsCard('Le procès de Zetchi s’ouvre enfin après six reports et près de deux ans de détention provisoire.', french)).toBe(true);
    });

    it('should drop such a line from the analysis, and leave the others, a "next" line included', async () => {
        // a line its sources support in every way, but the card says it already
        const again = 'The FIFA Council will vote on 18 March in Rabat. Gianni Infantino seeks another term, the BBC says.';
        const lines = await checkedLines({
            why: [{text: again, cites: ['A1 s1', 'A1 s2']}, {text: 'UEFA says the plan of Infantino lacks support.', cites: ['A2 s1']}],
            next: [{if: 'the Council refuses', then: 'the plan is dropped', cites: ['A2 s2']}],
        }, card(1, 11, {summary: again, titleTranslation: null}));
        expect(lines.why).toEqual(['UEFA says the plan of Infantino lacks support.']);
        expect(lines.next).toEqual([{if: 'the Council refuses', then: 'the plan is dropped'}]);
        expect(lines.dropped).toBe(1);
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

    it('should keep every card the AI picks, in its order, each once', async () => {
        chat.mockResolvedValueOnce(answer({cards: [9, 3, 1, 8, 2, 7, 5, 4, 3, 12].map(n => ({n, reason: `card ${n}`}))}));
        const cards = Array.from({length: 9}, (_, i) => card(i + 1, 100 + i));

        const picked = await pickedCards(cards, 'en');

        expect(picked.map(entry => entry.n)).toEqual([9, 3, 1, 8, 2, 7, 5, 4]);
    });

    it('should give a card no analysis when deepseek and the model that takes its place both fail, Gemini never asked', async () => {
        chat.mockImplementation(async ({messages}) => {
            if (messages[0].content.startsWith('You choose which cards')) return answer({cards: [{n: 1}]});
            throw Object.assign(new Error('down'), {status_code: 503});
        });

        const result = await analysesOf([card(1, 11)], 'en');

        expect(result).toEqual({picked: [{storyId: 11, reason: null}], cards: {}});
        // deepseek, then gpt-oss:120b for each call (8.11.2026), no other model
        expect(new Set(chat.mock.calls.map(([request]) => request.model))).toEqual(new Set([ANALYSIS_MODEL, 'gpt-oss:120b']));
    });

    it('should write the analysis with gpt-oss:120b when deepseek fails on it, and say so in the usage', async () => {
        chat.mockImplementation(async ({model, messages}) => {
            if (messages[0].content.startsWith('You choose which cards')) return answer({cards: [{n: 1}]});
            if (model === ANALYSIS_MODEL) throw Object.assign(new Error('down'), {status_code: 500});
            return answer({why: [{text: 'UEFA says the plan of Infantino lacks support.', cites: ['A2 s1']}], next: []});
        });
        const usage = newUsage();

        const result = await analysesOf([card(1, 11)], 'en', {usage});

        expect(Object.keys(result.cards)).toEqual(['11']);
        expect(usage.models).toContain('gpt-oss:120b');
    });

    it('should say each card done, written or not, so a long analysis is not taken for one abandoned', async () => {
        chat.mockImplementation(async ({messages}) => {
            if (messages[0].content.startsWith('You choose which cards')) return answer({cards: [{n: 1}, {n: 2}]});
            if (messages[0].content.includes('Card 2')) throw Object.assign(new Error('bad request'), {status_code: 400});
            return answer({why: [{text: 'UEFA says the plan of Infantino lacks support.', cites: ['A2 s1']}], next: []});
        });
        const onCard = jest.fn(async () => { throw new Error('the database is away'); });

        const result = await analysesOf([card(1, 11), card(2, 12, {title: 'Card 2'})], 'en', {onCard});

        expect(onCard).toHaveBeenCalledTimes(2);
        expect(Object.keys(result.cards)).toEqual(['11']);
    });
});

describe('an analysis still running', () => {
    it('should be taken for one abandoned only after 12 minutes without a card done', async () => {
        const {analysisOfRow} = await import('../../services/briefing-service.js');
        const now = new Date('2026-10-17T12:00:00Z').getTime();
        const running = {status: 'running', startedAt: '2026-10-17T11:30:00Z'};

        expect(analysisOfRow(running, now)).toEqual({status: 'failed'});
        expect(analysisOfRow({...running, beatAt: '2026-10-17T11:55:00Z'}, now)).toEqual({...running, beatAt: '2026-10-17T11:55:00Z'});
        expect(analysisOfRow({...running, beatAt: '2026-10-17T11:45:00Z'}, now)).toEqual({status: 'failed'});
        expect(analysisOfRow({status: 'ready', startedAt: '2026-10-17T08:00:00Z'}, now)).toMatchObject({status: 'ready'});
    });
});
