//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.stance.js
//  Description: Tests for what the code does with the reading of the AI of the position of an association on a person (stance.js):
//               the answer is read only in the closed words, the words quoted must be in the text, and the position is
//               decided by the code: declared only when the speaker binds the association, says it as their own word and
//               plainly, else probable; none for a candidate speaking for himself, a stance toward another person, a
//               denial or an association that is not the one speaking. What the AI reads is measured on the real cases
//               (bench/federations/stance-bench.mjs); nothing is asked of it here
//

import {describe, expect, it, jest} from '@jest/globals';

const chat = jest.fn();
jest.unstable_mockModule('ollama', () => ({Ollama: jest.fn(() => ({chat}))}));
const {BINDING, positionOf, quoteHeld, readStance, readingOf, stancePrompt} = await import('../../services/utils/stance.js');

const article = {
    title: 'FAW boss renews call for Infantino to step down',
    passage: 'Chief executive Noel Mooney says the Football Association of Wales retains the view that Fifa president Gianni Infantino should step down.',
    medium: 'bbc.co.uk', date: '2026-10-27',
};
const answer = (more = {}) => ({
    about_association: true, speaker: 'Noel Mooney', speaker_kind: 'executive', stance: 'against', toward: 'person', explicit: true, mark: 'official',
    quote: 'retains the view that Fifa president Gianni Infantino should step down', ...more,
});
const decide = (more = {}, text = article) => positionOf(readingOf(answer(more), text));

describe('quoteHeld', () => {
    it('should hold words that are in the text, whatever the case, the accents and the kind of quotes', () => {
        expect(quoteHeld('RETAINS THE VIEW that Fifa president', article)).toBe(true);
        expect(quoteHeld('Il a dit : «la solidarité»', {title: 'Il a dit : "La solidarité"', passage: ''})).toBe(true);
        expect(quoteHeld('Fédération', {title: 'federation', passage: ''})).toBe(true);
    });

    it('should not hold words that are not in the text, the title as well as the passage counting', () => {
        expect(quoteHeld('the federation will vote against him', article)).toBe(false);
        expect(quoteHeld('FAW boss renews call', article)).toBe(true);
        expect(quoteHeld('', article)).toBe(false);
        expect(quoteHeld('too', article)).toBe(false);
    });

    it('should hold a quote cut with an ellipsis when each part is in the text, and not when one is not', () => {
        expect(quoteHeld('Chief executive Noel Mooney says … should step down', article)).toBe(true);
        expect(quoteHeld('Chief executive Noel Mooney says ... should resign immediately', article)).toBe(false);
    });
});

describe('readingOf', () => {
    it('should read an answer in the closed words, in any case, and keep what it quotes', () => {
        const reading = readingOf(answer({stance: 'AGAINST', speaker_kind: 'Executive'}), article);
        expect(reading).toMatchObject({about: true, speaker: 'Noel Mooney', speakerKind: 'executive', stance: 'against', toward: 'person', explicit: true, mark: 'official', quoteHeld: true});
    });

    it('should read no answer that is not an object, misses a field, or uses a word that is none of the list', () => {
        expect(readingOf(null, article)).toBeNull();
        expect(readingOf('against', article)).toBeNull();
        expect(readingOf(answer({stance: 'hostile'}), article)).toBeNull();
        expect(readingOf(answer({speaker_kind: 'boss'}), article)).toBeNull();
        expect(readingOf(answer({mark: 'rumour'}), article)).toBeNull();
        expect(readingOf(answer({toward: 'him'}), article)).toBeNull();
        expect(readingOf(answer({explicit: 'yes'}), article)).toBeNull();
        expect(readingOf(answer({about_association: 'true'}), article)).toBeNull();
        const {mark, ...withoutMark} = answer();
        expect(mark).toBe('official');
        expect(readingOf(withoutMark, article)).toBeNull();
    });

    it('should say the words quoted are not in the text instead of trusting them', () => {
        expect(readingOf(answer({quote: 'the federation will never vote for him'}), article).quoteHeld).toBe(false);
        expect(readingOf(answer({quote: ''}), article).quoteHeld).toBe(false);
        expect(readingOf(answer({quote: 12}), article).quoteHeld).toBe(false);
    });
});

describe('positionOf: what the code decides', () => {
    it('should give a declared position to a speaker who binds, in their own words, plainly, on either side', () => {
        for (const speaker_kind of ['president', 'executive', 'statement']) {
            expect(decide({speaker_kind})).toEqual({signal: true, binds: true, position: 'non_soutien_declare'});
        }
        expect(decide({stance: 'for'})).toEqual({signal: true, binds: true, position: 'soutien_declare'});
    });

    it('should give only a probable one when the words are not plain: criticism, thanks, a hint', () => {
        expect(decide({explicit: false})).toMatchObject({signal: true, position: 'non_soutien_probable'});
        expect(decide({explicit: false, stance: 'for'})).toMatchObject({position: 'soutien_probable'});
    });

    it('should give only a probable one when it is hearsay, however plain', () => {
        expect(decide({mark: 'reported'})).toMatchObject({signal: true, position: 'non_soutien_probable'});
    });

    it('should give only a probable one to a speaker who does not bind the association, and say so', () => {
        for (const speaker_kind of ['deputy', 'former', 'other']) {
            expect(decide({speaker_kind})).toEqual({signal: true, binds: false, position: 'non_soutien_probable'});
        }
        expect([...BINDING].sort()).toEqual(['executive', 'president', 'statement']);
    });

    it('should give nothing to a candidate speaking for himself: his word is not the association\'s', () => {
        expect(decide({speaker_kind: 'candidate'})).toEqual({signal: false, position: null, why: 'candidate_himself'});
    });

    it('should give nothing when the association is not the one speaking, whatever else the answer says', () => {
        expect(decide({about_association: false})).toEqual({signal: false, position: null, why: 'not_about_association'});
    });

    it('should give nothing to a stance toward someone else, an undecided one, none, or a denial', () => {
        expect(decide({toward: 'other'})).toMatchObject({signal: false, why: 'not_toward_person'});
        expect(decide({toward: 'nobody', stance: 'none'})).toMatchObject({signal: false});
        expect(decide({stance: 'undecided'})).toEqual({signal: false, position: null, why: 'stance_undecided'});
        expect(decide({stance: 'none'})).toEqual({signal: false, position: null, why: 'stance_none'});
        expect(decide({mark: 'denied'})).toEqual({signal: false, position: null, why: 'denied'});
    });

    it('should give nothing when the words quoted are not in the text, even for a plain declared one', () => {
        expect(decide({quote: 'the federation has decided to vote against him'})).toEqual({signal: false, position: null, why: 'quote_not_found'});
    });

    it('should give nothing for an answer that is not one', () => {
        expect(positionOf(null)).toEqual({signal: false, position: null, why: 'unreadable'});
    });
});

describe('the prompt', () => {
    const item = {
        subject: {name: 'Gianni Infantino'},
        association: {name: 'Football Association of Moldova', country: 'Moldova', aliases: ['FMF']},
        article,
    };

    it('should name the association with the other ways it is written, the person and the article', () => {
        const prompt = stancePrompt(item);
        expect(prompt).toContain('Football Association of Moldova (Moldova), also written: FMF');
        expect(prompt).toContain('The person asked about: Gianni Infantino.');
        expect(prompt).toContain('(bbc.co.uk, 2026-10-27): "FAW boss renews call for Infantino to step down"');
        expect(prompt).toContain('Passage: "Chief executive Noel Mooney');
    });

    it('should leave the passage out when there is none (a title alone), and the aliases when there are none', () => {
        const prompt = stancePrompt({...item, association: {name: 'Football Australia', country: 'Australia', aliases: []}, article: {...article, passage: ''}});
        expect(prompt).not.toContain('Passage:');
        expect(prompt).not.toContain('also written');
    });
});

describe('readStance', () => {
    const item = {subject: {name: 'Gianni Infantino'}, association: {name: 'Football Association of Wales', country: 'Wales', aliases: ['FAW']}, article};
    const reply = (value) => chat.mockResolvedValueOnce({message: {content: JSON.stringify(value)}, prompt_eval_count: 10, eval_count: 5});

    it('should ask once and return the reading with the decision of the code', async () => {
        chat.mockReset();
        reply(answer());
        const usage = {calls: 0, input: 0, output: 0};
        const result = await readStance(item, usage, {model: 'gemma4:31b', fallback: null});
        expect(chat).toHaveBeenCalledTimes(1);
        expect(chat.mock.calls[0][0].model).toBe('gemma4:31b');
        expect(result.decision).toEqual({signal: true, binds: true, position: 'non_soutien_declare'});
        expect(result.reading.quoteHeld).toBe(true);
        expect(usage.calls).toBe(1);
    });

    it('should decide nothing from an answer in words that are not the list', async () => {
        chat.mockReset();
        reply(answer({stance: 'angry'}));
        const result = await readStance(item, null, {model: 'gemma4:31b', fallback: null});
        expect(result).toEqual({reading: null, decision: {signal: false, position: null, why: 'unreadable'}});
    });
});
