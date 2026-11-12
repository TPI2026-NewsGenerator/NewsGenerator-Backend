//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-watch.js
//  Description: Tests for the reading of the news in the background (FifaService.watch): the first reading of a candidate takes the 30 days and makes him ready, a later one
//               reads from a little before where the last stopped, what was read is not read again, a passage the code cannot attribute is not kept, at most
//               FIFA_MAX_PASSAGES passages are read for a candidate (the newest) so that a person named in thousands of sentences does not cost more than
//               a reader thinks, and a candidate that fails leaves the others. The database and the AI are mocked
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import process from 'node:process';

process.env.FIFA_MAX_PASSAGES = '3';
const model = Object.fromEntries(['subjects', 'markChecked', 'news', 'linkedNames', 'mentionNames', 'knownHashes', 'insertSignal', 'unconfirmed', 'updateSignal'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})}));
const {FifaService} = await import('../../services/fifa-service.js');

const SUBJECT = {qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino'], status: 'incumbent', state: 'computing', color_index: 1, checked_at: null};
const article = (id, text, day) => ({id, title: text, description: '', text, lang: 'en', medium: `m${id}.com`, story: id, link: `https://example.com/${id}`, at: new Date(`2026-11-${String(day).padStart(2, '0')}T10:00:00Z`)});
const reading = (more = {}) => ({about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'against', toward: 'person', mark: 'official', level: 'declared', status: 'established',
    reason: '', confidence: 'high', note: '', quote: 'will not back Infantino', speaker: 'X', ...more});

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    ollamaJson.mockReset();
    model.subjects.mockResolvedValue([SUBJECT]);
    model.markChecked.mockResolvedValue(1);
    model.insertSignal.mockResolvedValue(1);
    model.linkedNames.mockResolvedValue([]);
    model.mentionNames.mockResolvedValue([]);
    model.unconfirmed.mockResolvedValue([]);
    model.knownHashes.mockResolvedValue(new Set());
    ollamaJson.mockResolvedValue(reading());
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('FifaService.watch', () => {
    it('should read the 30 days the first time, keep what was read with its sentence copied, and make the candidate ready', async () => {
        model.news.mockResolvedValue([article(1, 'The Danish Football Association will not back Infantino', 5)]);
        const result = await FifaService.watch();
        expect(result).toMatchObject({read: 1});
        const {since} = model.news.mock.calls[0][0];
        expect(Date.now() - new Date(since).getTime()).toBeGreaterThan(29 * 864e5);
        expect(Date.now() - new Date(since).getTime()).toBeLessThan(31 * 864e5);
        expect(model.insertSignal).toHaveBeenCalledWith(expect.objectContaining({
            subject_qid: SUBJECT.qid, certainty: 'established', stance: 'against', level: 'declared', sentence: expect.stringContaining('will not back Infantino'), title: expect.any(String),
            medium: 'm1.com', published_at: '2026-11-05', read_by: expect.any(Array), confirmed: true}));
        expect(model.markChecked).toHaveBeenCalledWith(SUBJECT.qid, expect.any(Date), true);
    });

    it('should read from a little before where the last reading stopped, and not make a candidate ready twice', async () => {
        const checked = new Date(Date.now() - 3600e3);
        model.subjects.mockResolvedValue([{...SUBJECT, state: 'ready', checked_at: checked}]);
        model.news.mockResolvedValue([]);
        await FifaService.watch();
        const {since} = model.news.mock.calls[0][0];
        expect(checked.getTime() - new Date(since).getTime()).toBe(10 * 60e3);
        expect(model.markChecked).toHaveBeenCalledWith(SUBJECT.qid, expect.any(Date), false);
    });

    it('should not read a passage again, and keep nothing of a passage the code cannot attribute to the association', async () => {
        model.news.mockResolvedValue([article(1, 'JFA honorary president Tashima runs against Infantino', 5), article(2, 'The Danish Football Association will not back Infantino', 6)]);
        // the first is not attributed (a bare acronym with no country), the second was read before
        model.linkedNames.mockResolvedValue([{id: 1, qid: 'Q579842', name: 'JFA'}]);
        model.knownHashes.mockImplementation(async (qid, hashes) => new Set(hashes.slice(1)));
        await FifaService.watch();
        expect(model.insertSignal.mock.calls.length).toBeLessThanOrEqual(1);
        expect(ollamaJson.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('should read at most FIFA_MAX_PASSAGES passages, the newest, and say how many are left', async () => {
        model.news.mockResolvedValue([1, 2, 3, 4, 5].map(id => article(id, `The Danish Football Association will not back Infantino, number ${id}`, id + 1)));
        await FifaService.watch();
        expect(model.insertSignal).toHaveBeenCalledTimes(3);
        expect(model.insertSignal.mock.calls.map(call => call[0].published_at).sort()).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('2 older passages are left unread'));
    });

    it('should leave the others when a candidate fails, and read him again from where he was', async () => {
        const WENGER = {...SUBJECT, qid: 'Q215244', name: 'Arsene Wenger', terms: ['wenger']};
        model.subjects.mockResolvedValue([SUBJECT, WENGER]);
        model.news.mockRejectedValueOnce(new Error('database away')).mockResolvedValue([]);
        const result = await FifaService.watch();
        expect(result).toBeDefined();
        expect(model.markChecked).toHaveBeenCalledTimes(1);
        expect(model.markChecked).toHaveBeenCalledWith(WENGER.qid, expect.any(Date), true);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Gianni Infantino was not read'));
    });

    it('should do one run at a time', async () => {
        model.news.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([]), 30)));
        const [first, second] = await Promise.all([FifaService.watch(), FifaService.watch()]);
        expect([first, second].filter(result => result.skipped)).toHaveLength(1);
    });
});
