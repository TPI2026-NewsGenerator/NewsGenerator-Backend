//
//  Author: Fabian Rostello
//  Date: 13.11.2026
//  File: test.fifa-summary.js
//  Description: Tests for the summary of the sheet of an association (fifa-summary.js and summaryOf, contextOf of fifa-map.js): the summary the CODE builds (where the association stands on
//               each candidate, the sentences said word for word, who spoke), the context of its confederation, the numbered facts, the prompt, and the check of the claims a model
//               writes from them (a claim that cites no fact that exists, or holds a figure the facts do not hold, is dropped). Pure: no AI is called
//

import {describe, expect, it} from '@jest/globals';
import {MEMBER_LIST, memberOfFifa} from '../../services/utils/fifa-members.js';
import {buildMap, buildSheet, contextOf} from '../../services/utils/fifa-map.js';
import {claimsOf, factsOf, inputHashOf, promptOfSummary} from '../../services/utils/fifa-summary.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const SUBJECT = {qid: 'Q124138', name: 'Gianni Infantino', color_index: 1, status: 'incumbent', state: 'ready'};
const WENGER = {qid: 'Q47576', name: 'Arsene Wenger', color_index: 2, status: 'rumoured', state: 'ready'};
const TASHIMA = {qid: 'Q2633169', name: 'Kozo Tashima', color_index: 3, status: 'declared', state: 'ready'};
const jp = memberOfFifa('JPN'), kor = memberOfFifa('KOR'), chn = memberOfFifa('CHN'), afc = memberOfFifa('AFC');
let id = 0;
const signal = (member, at, more = {}) => ({
    id: ++id, subject_qid: SUBJECT.qid, member_qid: member.qid, certainty: 'established', uncertain_reason: '', stance: 'against', level: 'declared', mark: 'official',
    speaker_kind: 'president', speaker: 'Kozo Tashima', sentence: `Sentence ${id}`, url: `https://example.com/${id}`, medium: 'example.com', lang: 'en', published_at: at, news_count: 1, ...more,
});
const sheetOf = (signals, member = jp, subjects = [SUBJECT, WENGER, TASHIMA]) => buildSheet({member, subjects, signals, votes: [], now: NOW, colour: 'established'});

describe('summaryOf, built by the code', () => {
    const signals = [
        signal(jp, '2026-10-01T10:00:00Z', {stance: 'for', level: 'probable', speaker: '', speaker_kind: 'executive', sentence: 'An executive hints at support.', medium: 'a.com'}),
        signal(jp, '2026-11-05T10:00:00Z', {stance: 'against', level: 'declared', sentence: 'The JFA will not back him.', medium: 'b.com'}),
        signal(jp, '2026-11-06T10:00:00Z', {stance: 'against', level: 'probable', speaker_kind: 'statement', speaker: '', sentence: 'A statement of the JFA.', medium: 'c.com'}),
        signal(jp, '2026-11-07T10:00:00Z', {subject_qid: WENGER.qid, certainty: 'uncertain', uncertain_reason: 'not_binding', stance: 'none', level: 'none'}),
    ];

    it('should list the candidates the association has something on, the strongest first, with the ones with nothing left out', () => {
        const {candidates} = sheetOf(signals).summary;
        expect(candidates.map(one => one.name)).toEqual(['Gianni Infantino', 'Arsene Wenger']);
        expect(candidates[0]).toMatchObject({subject_qid: SUBJECT.qid, position: 'non_soutien_declare', changed: true, signals_count: 3});
        expect(candidates[1]).toMatchObject({position: 'inconnue', uncertain_count: 1, sides: []});
    });

    it('should put the candidates the association supports first, then the ones it opposes, whatever their order and strength, then the ones with no position', () => {
        const sheet = sheetOf([
            signal(jp, '2026-11-05T10:00:00Z', {stance: 'against', level: 'declared'}),
            signal(jp, '2026-11-06T10:00:00Z', {subject_qid: WENGER.qid, stance: 'for', level: 'declared'}),
            signal(jp, '2026-11-07T10:00:00Z', {subject_qid: TASHIMA.qid, stance: 'for', level: 'probable'}),
            signal(jp, '2026-11-08T10:00:00Z', {subject_qid: 'Q9999', certainty: 'uncertain', uncertain_reason: 'praise', stance: 'none', level: 'none'}),
        ], jp, [SUBJECT, WENGER, TASHIMA, {qid: 'Q9999', name: 'Someone Else', color_index: 4, status: 'declared', state: 'ready'}]);
        // Infantino (the first colour) opposed and declared comes AFTER Wenger (supported, declared) and Tashima (supported, probable)
        expect(sheet.summary.candidates.map(one => one.name)).toEqual(['Arsene Wenger', 'Kozo Tashima', 'Gianni Infantino', 'Someone Else']);
        expect(sheet.summary.candidates.map(one => one.position)).toEqual(['soutien_declare', 'soutien_probable', 'non_soutien_declare', 'inconnue']);
    });

    it('should put a candidate a reader confirmed or set among the supported ones, and a reader\'s "no position" with the ones with none', () => {
        const votes = [
            {user_id: 1, username: 'reader1', subject_qid: WENGER.qid, member_qid: jp.qid, value: 'confirm', note: '', seen: 'soutien_probable', created_at: '2026-11-10T10:00:00Z'},
            {user_id: 2, username: 'reader2', subject_qid: TASHIMA.qid, member_qid: jp.qid, value: 'unknown', note: '', created_at: '2026-11-10T11:00:00Z'},
        ];
        const sheet = buildSheet({member: jp, subjects: [SUBJECT, WENGER, TASHIMA], signals: [signal(jp, '2026-11-05T10:00:00Z', {stance: 'against', level: 'declared'}),
            signal(jp, '2026-11-06T10:00:00Z', {subject_qid: WENGER.qid, stance: 'for', level: 'probable'})], votes, now: NOW, colour: 'established'});
        // Wenger: probable support confirmed by a reader (solid), Infantino: opposition, Tashima: a reader says no position
        expect(sheet.summary.candidates.map(one => one.name)).toEqual(['Arsene Wenger', 'Gianni Infantino', 'Kozo Tashima']);
        expect(sheet.summary.candidates[0].position).toBe('soutien_declare');
    });

    it('should give for each side the sentences said word for word, the declared and the binding ones first, who spoke, and the dates', () => {
        const [infantino] = sheetOf(signals).summary.candidates;
        expect(infantino.sides.map(side => side.stance)).toEqual(['against', 'for']);   // the side of the position first
        const against = infantino.sides[0];
        expect(against).toMatchObject({declared: 1, probable: 1, media: 2, first_at: '2026-11-05T10:00:00.000Z', last_at: '2026-11-06T10:00:00.000Z'});
        expect(against.key.map(one => one.sentence)).toEqual(['The JFA will not back him.', 'A statement of the JFA.']);
        expect(against.key[0]).toMatchObject({level: 'declared', speaker: 'Kozo Tashima', role: 'President', binds: true, url: expect.stringContaining('https://example.com/'), medium: 'b.com'});
        expect(against.speakers).toEqual([{name: 'Kozo Tashima', role: 'President', binds: true}]);
        expect(infantino.sides[1].speakers).toEqual([]);
    });

    it('should keep at most two sentences of a side, never twice the same article, and carry the latest change of position', () => {
        const many = [...Array.from({length: 4}, (_, at) => signal(jp, `2026-11-0${at + 1}T10:00:00Z`, {url: at < 2 ? 'https://example.com/same' : `https://example.com/${at}`})),
            signal(jp, '2026-09-01T10:00:00Z', {stance: 'for', level: 'declared'})];
        const [infantino] = sheetOf(many).summary.candidates;
        const against = infantino.sides.find(side => side.stance === 'against');
        expect(against.key).toHaveLength(2);
        expect(new Set(against.key.map(one => one.url)).size).toBe(2);
        expect(infantino.latest_change).toMatchObject({kind: 'reversal', subject_qid: SUBJECT.qid});
    });

    it('should show a position set by a reader as such, and count it as strong as a declared one', () => {
        const votes = [{user_id: 1, username: 'reader1', subject_qid: WENGER.qid, member_qid: jp.qid, value: 'for', note: '', created_at: '2026-11-10T10:00:00Z'}];
        const sheet = buildSheet({member: jp, subjects: [SUBJECT, WENGER], signals: [signal(jp, '2026-11-05T10:00:00Z', {stance: 'against', level: 'probable'})], votes, now: NOW, colour: 'established'});
        expect(sheet.summary.candidates.map(one => one.name)).toEqual(['Arsene Wenger', 'Gianni Infantino']);
        expect(sheet.summary.candidates[0]).toMatchObject({human: {value: 'for', by: 'reader1'}, position: 'soutien_declare'});
    });
});

describe('contextOf, the rest of the confederation', () => {
    const afcSignals = [signal(afc, '2026-11-01T10:00:00Z', {stance: 'for'}), signal(kor, '2026-11-02T10:00:00Z', {stance: 'for', level: 'probable'}), signal(chn, '2026-11-03T10:00:00Z', {stance: 'against'})];
    const map = buildMap({members: MEMBER_LIST, subjects: [SUBJECT, WENGER], signals: afcSignals, votes: [], now: NOW, colour: 'established'});

    it('should tell the position of the confederation and how the OTHER associations of it stand, on each candidate', () => {
        const total = MEMBER_LIST.filter(member => member.level !== 'confederation' && member.confederation === 'AFC' && member.qid !== jp.qid).length;
        const context = contextOf({member: jp, map});
        expect(context.confederation).toMatchObject({qid: afc.qid, fifa: 'AFC'});
        expect(context.own).toEqual({[SUBJECT.qid]: {position: 'soutien_declare', since: expect.any(String)}});
        expect(context.associations[SUBJECT.qid]).toEqual({for: 1, against: 1, unknown: total - 2, total});
        expect(context.associations[WENGER.qid]).toEqual({for: 0, against: 0, unknown: total, total});
    });

    it('should leave out the association itself, and give nothing for a confederation', () => {
        const withJapan = buildMap({members: MEMBER_LIST, subjects: [SUBJECT], signals: [...afcSignals, signal(jp, '2026-11-04T10:00:00Z', {stance: 'for'})], votes: [], now: NOW, colour: 'established'});
        expect(contextOf({member: jp, map: withJapan}).associations[SUBJECT.qid]).toMatchObject({for: 1, against: 1});
        expect(contextOf({member: afc, map})).toBeNull();
        expect(contextOf({member: null, map})).toBeNull();
    });
});

describe('factsOf and the prompt', () => {
    const signals = [signal(jp, '2026-11-05T10:00:00Z', {sentence: 'The JFA will not back him.', medium: 'b.com'})];
    const summary = sheetOf(signals).summary;
    const map = buildMap({members: MEMBER_LIST, subjects: [SUBJECT], signals: [...signals, signal(afc, '2026-11-01T10:00:00Z', {stance: 'for'})], votes: [], now: NOW, colour: 'established'});
    const facts = factsOf({member: jp, summary, context: contextOf({member: jp, map})});

    it('should number the facts: where it stands, the sentence word for word with its date, medium and speaker, then the confederation', () => {
        expect(facts.map(fact => [fact.id, fact.kind])).toEqual([[1, 'position'], [2, 'sentence'], [3, 'confederation']]);
        expect(facts[0].text).toMatch(/shown against Gianni Infantino at the declared level since 5 Nov 2026, read from the news: 1 established signal/);
        expect(facts[1]).toMatchObject({url: expect.stringContaining('https://example.com/'), medium: 'b.com'});
        expect(facts[1].text).toContain('"The JFA will not back him."');
        expect(facts[1].text).toContain('said by Kozo Tashima (President, speaks for the association)');
        // no other association of the confederation has a position yet: the fact says nothing of them
        expect(facts[2].text).toBe('AFC itself is shown for Gianni Infantino (declared).');
    });

    it('should say when an association has no established position, and give no facts for a sheet with nothing', () => {
        const none = factsOf({member: jp, summary: sheetOf([signal(jp, '2026-11-07T10:00:00Z', {certainty: 'uncertain', uncertain_reason: 'praise', stance: 'none', level: 'none'})], jp, [SUBJECT]).summary});
        expect(none[0].text).toMatch(/no established position on Gianni Infantino: 1 sentence/);
        expect(factsOf({member: jp, summary: {candidates: []}})).toEqual([]);
    });

    it('should give the model only the facts and the rules, in a fixed form', () => {
        const prompt = promptOfSummary({member: jp, facts});
        expect(prompt).toContain('ONLY from the numbered facts below');
        expect(prompt).toContain(`Association: ${jp.name}`);
        expect(prompt).toContain('2. 5 Nov 2026, b.com');
        expect(prompt).toContain('{"claims": [{"text": "...", "facts": [1, 2]}]}');
    });

    it('should change its fingerprint when a fact changes, and not otherwise', () => {
        expect(inputHashOf(facts)).toBe(inputHashOf(factsOf({member: jp, summary, context: contextOf({member: jp, map})})));
        expect(inputHashOf(facts)).not.toBe(inputHashOf(facts.slice(0, 2)));
    });
});

describe('claimsOf, the check of what a model wrote', () => {
    const facts = [
        {id: 1, kind: 'position', text: 'Japan is shown against Gianni Infantino at the declared level since 5 Nov 2026: 3 established signals, 2 media.'},
        {id: 2, kind: 'sentence', text: '5 Nov 2026, b.com, against Gianni Infantino, said by Kozo Tashima: "The JFA will not back him."'},
    ];

    it('should keep the claims that cite facts that exist and hold only the figures of those facts', () => {
        const kept = claimsOf({claims: [
            {text: 'Japan is shown against Gianni Infantino, at the declared level since 5 Nov 2026.', facts: [1]},
            {text: 'Its president said it would not back him on 5 Nov.', facts: ['2', 2, 9]},
        ]}, facts);
        expect(kept).toEqual([
            {text: 'Japan is shown against Gianni Infantino, at the declared level since 5 Nov 2026.', facts: [1]},
            {text: 'Its president said it would not back him on 5 Nov.', facts: [2]},
        ]);
    });

    it('should drop a claim with a figure the cited facts do not hold, one that cites nothing that exists, and one too short or too long', () => {
        const kept = claimsOf({claims: [
            {text: 'Japan has been against him for 12 years.', facts: [1]},
            {text: 'Japan is against Gianni Infantino.', facts: [7]},
            {text: 'Japan is against Gianni Infantino.', facts: []},
            {text: 'Japan is against Gianni Infantino.'},
            {text: 'Too short', facts: [1]},
            {text: 'x'.repeat(401), facts: [1]},
            {text: 'It cites the fact that does not hold the figure 3 media.', facts: [2]},
            {text: 'Japan is against Gianni Infantino, with 3 established signals.', facts: [1]},
        ]}, facts);
        expect(kept.map(one => one.text)).toEqual(['Japan is against Gianni Infantino, with 3 established signals.']);
    });

    it('should keep five claims at most, and give none for an answer that is not claims', () => {
        const six = Array.from({length: 6}, (_, at) => ({text: `Japan is against Gianni Infantino, claim ${at}.`.replace(/\d/, ''), facts: [1]}));
        expect(claimsOf({claims: six}, facts)).toHaveLength(5);
        for (const answer of [null, undefined, 'claims', {}, {claims: 'none'}, {claims: [null, 3]}]) expect(claimsOf(answer, facts)).toEqual([]);
    });
});
