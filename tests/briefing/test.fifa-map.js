//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-map.js
//  Description: Tests for what the page "The FIFA presidency" reads (fifa-map.js): the position of an association on a candidate from its established signals,
//               an uncertain signal that never colours, the vote of a reader that decides for everyone (the latest vote of each reader who has not taken it
//               back), the news that came after the vote, FIFA_COLOUR (declared / established / off), the history of the changes, the sheet
//

import {describe, expect, it} from '@jest/globals';
import {MEMBER_LIST, memberOfFifa} from '../../services/utils/fifa-members.js';
import {buildMap, buildSheet, colourSetting, decisiveVote, levelsOf, reasonFor} from '../../services/utils/fifa-map.js';

const NOW = new Date('2026-11-12T12:00:00Z');
const SUBJECT = {qid: 'Q124138', name: 'Gianni Infantino', color_index: 1, status: 'incumbent', state: 'ready'};
const WENGER = {qid: 'Q9999', name: 'Arsene Wenger', color_index: 2, status: 'rumoured', state: 'ready'};
const jp = memberOfFifa('JPN'), afc = memberOfFifa('AFC'), den = memberOfFifa('DEN');
let id = 0;
const signal = (member, at, more = {}) => ({
    id: ++id, subject_qid: SUBJECT.qid, member_qid: member.qid, certainty: 'established', uncertain_reason: '', stance: 'against', level: 'declared', mark: 'official',
    speaker_kind: 'president', speaker: 'Someone', sentence: `Sentence ${id}`, url: `https://example.com/${id}`, medium: 'example.com', lang: 'en', published_at: at, news_count: 1, ...more,
});
const vote = (member, userId, value, at, more = {}) => ({subject_qid: SUBJECT.qid, member_qid: member.qid, user_id: userId, username: `reader${userId}`, value, note: '', created_at: at, ...more});
const map = (signals, votes = [], more = {}) => buildMap({members: MEMBER_LIST, subjects: [SUBJECT, WENGER], signals, votes, now: NOW, colour: 'established', ...more});
const memberRow = (answer, member) => answer.members.find(row => row.fifa === member.fifa);

describe('the colour setting', () => {
    it('should name the levels the page may draw, and read FIFA_COLOUR with a safe default', () => {
        expect(levelsOf('established')).toEqual(['soutien_declare', 'soutien_probable', 'inconnue', 'non_soutien_probable', 'non_soutien_declare']);
        expect(levelsOf('declared')).toEqual(['soutien_declare', 'inconnue', 'non_soutien_declare']);
        expect(levelsOf('off')).toEqual(['inconnue']);
        expect(colourSetting('declared')).toBe('declared');
        expect(colourSetting('nonsense')).toBe('established');
        expect(reasonFor('not_binding')).toBe('speaker_not_binding');
        expect(reasonFor('unconfirmed')).toBe('unconfirmed');
    });
});

describe('buildMap', () => {
    it('should carry the 211 associations and the 6 confederations, with the position only where there is something to say', () => {
        const answer = map([signal(jp, '2026-11-01T10:00:00Z')]);
        expect(answer.members).toHaveLength(217);
        expect(Object.keys(memberRow(answer, jp).positions)).toEqual([SUBJECT.qid]);
        expect(memberRow(answer, afc).positions).toEqual({});
        expect(answer.subjects[0]).toMatchObject({qid: SUBJECT.qid, positions_known: 1, uncertain_count: 0});
        expect(answer.levels).toHaveLength(5);
    });

    it('should colour from the established signals, with the sources that explain it, and never from an uncertain one', () => {
        const answer = map([signal(jp, '2026-11-01T10:00:00Z', {stance: 'for', level: 'probable'}), signal(den, '2026-11-02T10:00:00Z', {certainty: 'uncertain', uncertain_reason: 'not_binding', level: 'none'})]);
        expect(memberRow(answer, jp).positions[SUBJECT.qid]).toMatchObject({position: 'soutien_probable', signals_count: 1, uncertain_count: 0, human: null, basis: [{medium: 'example.com'}]});
        expect(memberRow(answer, den).positions[SUBJECT.qid]).toMatchObject({position: 'inconnue', uncertain_count: 1, basis: []});
        expect(answer.subjects[0]).toMatchObject({positions_known: 1, uncertain_count: 1});
    });

    it('should count the articles and the media of an association over every candidate, as its coverage', () => {
        const answer = map([signal(jp, '2026-11-01T10:00:00Z', {news_count: 3, medium: 'a.com'}), signal(jp, '2026-11-02T10:00:00Z', {news_count: 2, medium: 'b.com', subject_qid: WENGER.qid})]);
        expect(memberRow(answer, jp).coverage).toEqual({articles_30d: 5, media_30d: 2});
    });

    it('should put only the declared in colour with FIFA_COLOUR=declared, and the probable among the uncertain', () => {
        const signals = [signal(jp, '2026-11-01T10:00:00Z', {level: 'probable'}), signal(den, '2026-11-01T10:00:00Z', {level: 'declared'})];
        const answer = map(signals, [], {colour: 'declared'});
        expect(memberRow(answer, jp).positions[SUBJECT.qid]).toMatchObject({position: 'inconnue', uncertain_count: 1});
        expect(memberRow(answer, den).positions[SUBJECT.qid]).toMatchObject({position: 'non_soutien_declare'});
        expect(answer.levels).toEqual(levelsOf('declared'));
        expect(map(signals, [], {colour: 'off'}).members.every(row => Object.values(row.positions).every(p => p.position === 'inconnue'))).toBe(true);
    });
});

describe('the vote of a reader', () => {
    it('should decide over the news for everyone, and keep the position of the news as ai_position', () => {
        const answer = map([signal(jp, '2026-10-20T10:00:00Z', {stance: 'against'})], [vote(jp, 1, 'for', '2026-11-05T10:00:00Z')]);
        expect(memberRow(answer, jp).positions[SUBJECT.qid]).toMatchObject({
            position: 'soutien_declare', ai_position: 'non_soutien_declare', stale: false, human: {value: 'for', by: 'reader1', newer_evidence: false},
        });
        expect(answer.subjects[0].positions_known).toBe(1);
    });

    it('should make a position where the news say nothing, and "no position" is a decision too', () => {
        const answer = map([], [vote(afc, 2, 'against', '2026-11-05T10:00:00Z'), vote(den, 2, 'unknown', '2026-11-05T10:00:00Z')]);
        expect(memberRow(answer, afc).positions[SUBJECT.qid]).toMatchObject({position: 'non_soutien_declare', human: {value: 'against'}});
        expect(memberRow(answer, den).positions[SUBJECT.qid]).toMatchObject({position: 'inconnue', human: {value: 'unknown'}});
        expect(answer.subjects[0].positions_known).toBe(1);
    });

    it('should take the latest vote of each reader, the newest of them deciding, and a vote taken back counts for nothing', () => {
        const votes = [vote(jp, 1, 'for', '2026-11-01T10:00:00Z'), vote(jp, 2, 'against', '2026-11-02T10:00:00Z'), vote(jp, 1, 'withdraw', '2026-11-03T10:00:00Z')];
        expect(decisiveVote(votes)).toMatchObject({value: 'against', by: 'reader2'});
        expect(decisiveVote([...votes, vote(jp, 2, 'withdraw', '2026-11-04T10:00:00Z')])).toBeNull();
        expect(decisiveVote([vote(jp, 1, 'for', '2026-11-01T10:00:00Z'), vote(jp, 1, 'against', '2026-11-02T10:00:00Z')])).toMatchObject({value: 'against'});
    });

    it('should say there is news since the vote when it says the other thing, and not change the colour', () => {
        const answer = map([signal(jp, '2026-11-10T10:00:00Z', {stance: 'against'})], [vote(jp, 1, 'for', '2026-11-05T10:00:00Z')]);
        expect(memberRow(answer, jp).positions[SUBJECT.qid]).toMatchObject({position: 'soutien_declare', human: {newer_evidence: true}});
        const same = map([signal(jp, '2026-11-10T10:00:00Z', {stance: 'for'})], [vote(jp, 1, 'for', '2026-11-05T10:00:00Z')]);
        expect(memberRow(same, jp).positions[SUBJECT.qid].human.newer_evidence).toBe(false);
    });
});

describe('buildSheet', () => {
    const signals = [
        signal(afc, '2026-09-10T10:00:00Z', {stance: 'against', level: 'declared'}),
        signal(afc, '2026-10-23T10:00:00Z', {stance: 'for', level: 'declared', speaker: 'Salman', speaker_kind: 'president'}),
        signal(afc, '2026-10-25T10:00:00Z', {certainty: 'uncertain', uncertain_reason: 'rival', stance: 'none', level: 'none', speaker_kind: 'candidate'}),
        signal(afc, '2026-10-26T10:00:00Z', {certainty: 'discarded', stance: 'none', level: 'none'}),
    ];
    const sheet = buildSheet({member: afc, subjects: [SUBJECT], signals, votes: [vote(afc, 1, 'for', '2026-10-30T10:00:00Z', {note: 'It said so on its site'})], now: NOW});

    it('should give the signals newest first, the discarded ones left out, with the badge, the reason and who speaks', () => {
        expect(sheet.signals.map(s => s.certainty)).toEqual(['uncertain', 'established', 'established']);
        expect(sheet.signals[0]).toMatchObject({uncertain_reason: 'rival_from_association', speaker: {role: 'Candidate', binds: false}});
        expect(sheet.signals[1]).toMatchObject({speaker: {name: 'Salman', role: 'President', binds: true}, url: expect.stringContaining('https://')});
    });

    it('should tell the reversal of the AFC, and the vote with who gave it', () => {
        expect(sheet.history).toEqual([
            {subject_qid: SUBJECT.qid, date: '2026-09-10T10:00:00Z', from: 'inconnue', to: 'non_soutien_declare', kind: 'first'},
            {subject_qid: SUBJECT.qid, date: '2026-10-23T10:00:00Z', from: 'non_soutien_declare', to: 'soutien_declare', kind: 'reversal'},
        ]);
        expect(sheet.votes).toEqual([{subject_qid: SUBJECT.qid, value: 'for', by: 'reader1', at: '2026-10-30T10:00:00.000Z', note: 'It said so on its site'}]);
        expect(sheet.positions[SUBJECT.qid]).toMatchObject({position: 'soutien_declare', human: {value: 'for'}});
    });

    it('should show a signal the colour setting does not colour as uncertain, with the reason', () => {
        const probable = buildSheet({member: jp, subjects: [SUBJECT], signals: [signal(jp, '2026-11-01T10:00:00Z', {level: 'probable'})], votes: [], colour: 'declared', now: NOW});
        expect(probable.signals[0]).toMatchObject({certainty: 'uncertain', uncertain_reason: 'colour_setting'});
    });
});
