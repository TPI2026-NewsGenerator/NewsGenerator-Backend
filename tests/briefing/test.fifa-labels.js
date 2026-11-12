//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-labels.js
//  Description: Tests for the closed words of the reading of a passage and what the code decides from them (fifa-labels.js): established needs a bound speaker, official,
//               a stance toward the person; a reason that holds a reading back (request, past, praise, ambiguous, other) keeps it uncertain whatever the fields say; a
//               model that calls a deputy "established" is read as uncertain, not binding; praise alone is no position (rule 5 of the guide, decided 12.11.2026)
//

import {describe, expect, it} from '@jest/globals';
import {HELD_BACK, VOCAB, formProblems, problemsOf, statusOf} from '../../services/utils/fifa-labels.js';

const label = (more = {}) => ({
    id: 'x', about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'for', toward: 'person', mark: 'official', level: 'declared',
    status: 'established', reason: '', confidence: 'high', note: '', ...more,
});

describe('statusOf', () => {
    it('should call established a bound speaker, official, for or against the person', () => {
        expect(statusOf(label())).toEqual({status: 'established', reason: ''});
        expect(statusOf(label({speaker_kind: 'executive', stance: 'against'}))).toEqual({status: 'established', reason: ''});
    });

    it('should discard what is not about the election or not the association', () => {
        expect(statusOf(label({about_election: false}))).toEqual({status: 'discarded', reason: ''});
        expect(statusOf(label({association_ok: 'no'}))).toEqual({status: 'discarded', reason: ''});
    });

    it('should read a speaker who does not bind, a rival, a rumour and a denial as uncertain, with the reason', () => {
        expect(statusOf(label({speaker_kind: 'deputy'}))).toEqual({status: 'uncertain', reason: 'not_binding'});
        expect(statusOf(label({speaker_kind: 'candidate'}))).toEqual({status: 'uncertain', reason: 'rival'});
        expect(statusOf(label({toward: 'other'}))).toEqual({status: 'uncertain', reason: 'rival'});
        expect(statusOf(label({mark: 'reported'}))).toEqual({status: 'uncertain', reason: 'reported'});
        expect(statusOf(label({mark: 'denied'}))).toEqual({status: 'uncertain', reason: 'denied'});
    });

    it('should keep a reading uncertain when the reader holds it back, whatever the fields say: a request, the past, praise, a doubt', () => {
        for (const reason of ['request', 'past', 'praise', 'ambiguous', 'other']) expect(statusOf(label({reason}))).toEqual({status: 'uncertain', reason});
        expect(HELD_BACK).toContain('praise');
    });

    it('should not let praise colour: a bound speaker who thanks FIFA and praises its leadership is uncertain, reason praise (the South African case)', () => {
        // the fields of the reading the two models gave of the sentence of the SAFA: a president, official, for the person, probable
        const reading = label({stance: 'for', level: 'probable', reason: 'praise', note: 'praise of the leadership, no word of the election'});
        expect(statusOf(reading)).toEqual({status: 'uncertain', reason: 'praise'});
        // praise that also says he should stay stays a position (the guide says so; the reason is then none)
        expect(statusOf(label({stance: 'for', level: 'probable', reason: ''}))).toEqual({status: 'established', reason: ''});
    });
});

describe('the words and the checks', () => {
    it('should list praise among the reasons of an uncertain reading, and accept it in a label', () => {
        expect(VOCAB.reason).toContain('praise');
        expect(problemsOf(label({status: 'uncertain', reason: 'praise'}))).toEqual([]);
    });

    it('should call unusable a word that is none of the guide\'s, a stance with no level, and a missing id', () => {
        expect(formProblems(label({speaker_kind: 'journalist'}))).toEqual([expect.stringContaining('speaker_kind')]);
        expect(formProblems(label({level: 'none'}))).toEqual(['a stance for/against needs a level']);
        expect(formProblems({...label(), id: undefined})).toEqual(['no id']);
        expect(formProblems(label())).toEqual([]);
        // the status and the reason a model gives are not checked: the code decides them
        expect(formProblems(label({status: 'nonsense', reason: 'whatever'}))).toEqual([]);
    });
});
