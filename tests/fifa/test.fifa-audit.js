//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-audit.js
//  Description: Tests for the weekly audit of the positions the map of the FIFA presidency shows: the pure numbers (the interval, the sample, the agreement, the votes
//               against the news, the verdict), and the audit of the service with the database and the AI mocked: a third model reads the sample again, the
//               agreement and the disagreements are counted with the votes, a dry run keeps nothing, an unreadable answer is not counted as a disagreement
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {agrees, minAgreement, reportOf, sampleOf, sideOf, verdictOf, votesAgainstNews, wilson} from '../../services/utils/fifa-audit.js';

const model = Object.fromEntries(['subjects', 'signals', 'votes', 'leaders', 'auditSample', 'lastAudit', 'audits', 'addAudit'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})}));
const {FifaService} = await import('../../services/fifa-service.js');

describe('the numbers', () => {
    it('should give the interval of Wilson, wide for few and narrow for many', () => {
        expect(wilson(0, 0)).toEqual([0, 1]);
        const [lo, hi] = wilson(27, 30);
        expect(lo).toBeCloseTo(0.74, 1);
        expect(hi).toBeCloseTo(0.97, 1);
        expect(wilson(270, 300)[0]).toBeGreaterThan(0.86);
    });

    it('should name the side of a position', () => {
        expect(sideOf('soutien_declare')).toBe('for');
        expect(sideOf('non_soutien_probable')).toBe('against');
        expect(sideOf('inconnue')).toBeNull();
        expect(sideOf(undefined)).toBeNull();
    });

    it('should draw at random, the recent ones first, never more than asked', () => {
        const rows = [...Array(10).keys()].map(id => ({id, recent: id < 4}));
        const drawn = sampleOf(rows, 6);
        expect(drawn).toHaveLength(6);
        expect(drawn.slice(0, 4).every(row => row.recent)).toBe(true);
        expect(sampleOf(rows, 50)).toHaveLength(10);
        expect(sampleOf([], 5)).toEqual([]);
    });

    it('should call an agreement an established reading on the same side, and nothing else', () => {
        const signal = {stance: 'against'};
        expect(agrees({status: 'established', stance: 'against'}, signal)).toBe(true);
        expect(agrees({status: 'established', stance: 'for'}, signal)).toBe(false);
        expect(agrees({status: 'uncertain', stance: 'against'}, signal)).toBe(false);
        expect(agrees(null, signal)).toBe(false);
    });

    it('should count the votes that confirm, contradict or add, from the map as the page reads it', () => {
        const member = (fifa, positions) => ({qid: `Q-${fifa}`, fifa, positions});
        const human = (value, by = 'reader1') => ({value, by});
        const map = {members: [
            member('AAA', {S: {human: human('for'), ai_position: 'soutien_declare'}}),
            member('BBB', {S: {human: human('against'), ai_position: 'soutien_probable'}}),
            member('CCC', {S: {human: human('unknown'), ai_position: 'non_soutien_declare'}}),
            member('DDD', {S: {human: human('for'), ai_position: 'inconnue'}}),
            member('EEE', {S: {human: null, ai_position: undefined}}),
        ]};
        const votes = votesAgainstNews(map);
        expect(votes).toMatchObject({voted: 4, confirms: 1, contradicts: 2, adds: 1, validated: 0});
        expect(votes.contradicting.map(item => item.fifa)).toEqual(['BBB', 'CCC']);
    });

    it('should count the positions of the news a reader validated by a confirmation, apart from the votes', () => {
        const member = (fifa, position) => ({qid: `Q-${fifa}`, fifa, positions: {S: position}});
        const map = {members: [
            member('AAA', {human: null, ai_position: 'soutien_probable', position: 'soutien_declare', confirmed: {count: 1, by: ['reader1']}}),
            member('BBB', {human: null, ai_position: undefined, position: 'inconnue', confirmed: {count: 1, by: ['reader1']}}),
            member('CCC', {human: null, ai_position: undefined, position: 'soutien_declare', confirmed: {count: 0, outdated: 1}}),
        ]};
        expect(votesAgainstNews(map)).toMatchObject({voted: 0, validated: 1});
        expect(reportOf({sampled: 30, agreed: 27, unreadable: 0, auditor: 'x', verdict: 'ok', votes: votesAgainstNews(map)})).toContain('1 positions of the news validated by a confirmation');
    });

    it('should say ok, warning or too few, from the threshold (85% by default)', () => {
        expect(minAgreement(undefined)).toBe(0.85);
        expect(minAgreement('0.9')).toBe(0.9);
        expect(minAgreement('nonsense')).toBe(0.85);
        expect(verdictOf({sampled: 30, agreed: 27})).toBe('ok');
        expect(verdictOf({sampled: 30, agreed: 22})).toBe('warning');
        expect(verdictOf({sampled: 5, agreed: 5})).toBe('too_few');
    });

    it('should write a report with the figures, the disagreements and the votes against the news', () => {
        const text = reportOf({sampled: 30, agreed: 24, unreadable: 1, auditor: 'gpt-oss:120b', verdict: 'warning',
            votes: {voted: 3, confirms: 1, contradicts: 1, adds: 1, contradicting: [{by: 'reader2', human: 'against', fifa: 'JPN', ai: 'soutien_declare'}]},
            disagreements: [{auditor: 'uncertain', reason: 'not_binding', stance: 'for', member: 'UEFA', sentence: 'UEFA will support Tashima'}]});
        expect(text).toContain('WARNING');
        expect(text).toContain('24 agree = 80%');
        expect(text).toContain('1 unreadable');
        expect(text).toContain('[UEFA] UEFA will support Tashima');
        expect(text).toContain('reader2 sets "against" on JPN');
    });
});

describe('FifaService.audit', () => {
    const NOW = new Date();
    const row = (id, more = {}) => ({id, subject_qid: 'Q124138', member_qid: 'Q502018', hash: `h${id}`, matched: 'danish football association', sentence: `The Danish Football Association will not back Infantino ${id}`,
        title: `Title ${id}`, description: '', lang: 'en', url: 'https://example.com', medium: 'example.com', published_at: NOW, stance: 'against', level: 'declared', subject_name: 'Gianni Infantino', recent: true, ...more});
    const label = (more = {}) => ({about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'against', toward: 'person', mark: 'official', level: 'declared', status: 'established',
        reason: '', confidence: 'high', note: '', quote: 'will not back Infantino', speaker: 'X', ...more});

    beforeEach(() => {
        for (const fn of Object.values(model)) fn.mockReset();
        ollamaJson.mockReset();
        model.subjects.mockResolvedValue([]);
        model.signals.mockResolvedValue([]);
        model.votes.mockResolvedValue([]);
        model.leaders.mockResolvedValue([]);
        model.addAudit.mockResolvedValue(1);
    });

    it('should read the sample again with the third model, count the agreement and keep the audit', async () => {
        const rows = Array.from({length: 12}, (_, i) => row(i + 1));
        model.auditSample.mockResolvedValue(rows);
        let call = 0;
        // 9 of the 12 agree, 3 are read as uncertain
        ollamaJson.mockImplementation(async () => (++call <= 9 ? label() : label({speaker_kind: 'deputy'})));
        const result = await FifaService.audit({sample: 12});
        expect(result).toMatchObject({sampled: 12, agreed: 9, unreadable: 0, verdict: 'warning', auditor: 'gpt-oss:120b'});
        expect(result.details.disagreements).toHaveLength(3);
        expect(result.details.disagreements[0]).toMatchObject({auditor: 'uncertain', reason: 'not_binding', stance: 'against'});
        expect(ollamaJson).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({model: 'gpt-oss:120b', fallback: null}));
        expect(model.addAudit).toHaveBeenCalledTimes(1);
        expect(result.report).toContain('9 agree = 75%');
    });

    it('should say ok when the third model agrees, and keep nothing on a dry run', async () => {
        model.auditSample.mockResolvedValue(Array.from({length: 12}, (_, i) => row(i + 1)));
        ollamaJson.mockResolvedValue(label());
        const result = await FifaService.audit({sample: 12, dry: true});
        expect(result).toMatchObject({sampled: 12, agreed: 12, verdict: 'ok'});
        expect(model.addAudit).not.toHaveBeenCalled();
    });

    it('should not count an answer it could not read as a disagreement, and say too few for a small sample', async () => {
        model.auditSample.mockResolvedValue(Array.from({length: 4}, (_, i) => row(i + 1)));
        ollamaJson.mockRejectedValue(new Error('model away'));
        const result = await FifaService.audit({sample: 4, dry: true});
        expect(result).toMatchObject({sampled: 0, agreed: 0, unreadable: 4, verdict: 'too_few'});
        expect(result.details.disagreements).toEqual([]);
    });

    it('should count the votes against the news with the audit', async () => {
        model.auditSample.mockResolvedValue(Array.from({length: 10}, (_, i) => row(i + 1)));
        model.subjects.mockResolvedValue([{qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino'], status: 'incumbent', state: 'ready', color_index: 1}]);
        model.signals.mockResolvedValue([{id: 1, subject_qid: 'Q124138', member_qid: 'Q502018', certainty: 'established', stance: 'against', level: 'declared', mark: 'official', speaker_kind: 'president',
            speaker: 'X', sentence: 's', lang: 'en', url: 'u', medium: 'm', published_at: new Date('2026-11-01'), news_count: 1, media_count: 1, confirmed: true, uncertain_reason: ''}]);
        model.votes.mockResolvedValue([{user_id: 1, username: 'reader1', subject_qid: 'Q124138', member_qid: 'Q502018', value: 'for', note: '', created_at: new Date('2026-11-05')}]);
        ollamaJson.mockResolvedValue(label());
        const result = await FifaService.audit({dry: true});
        expect(result).toMatchObject({votes_total: 1, votes_contradicting: 1});
        expect(result.report).toContain('reader1 sets "for"');
    });
});
