//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: test.fifa-source-check.js
//  Description: Tests for the check of the source a reader joined to their choice (FifaService.checkSource): the page is read as the news are and the vote keeps what it says
//               (says, contradicts, unclear, unreadable), a failed AI leaves the check to be made again, nothing here changes a position. The database, the page and the
//               AI are mocked
//

import {setImmediate} from 'node:timers';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const model = Object.fromEntries(['subjects', 'voteById', 'setSourceCheck', 'expireSources', 'pendingSources'].map(name => [name, jest.fn()]));
jest.unstable_mockModule('../../models/fifa-model.js', () => ({FifaModel: model}));
const ollamaJson = jest.fn();
jest.unstable_mockModule('../../services/utils/ollama.js', () => ({ollamaJson, newUsage: () => ({calls: 0, input: 0, output: 0})}));
jest.unstable_mockModule('../../services/utils/wikidata.js', () => ({searchItems: jest.fn(), describeItems: jest.fn(), isQid: () => true, wikimediaHeaders: () => ({})}));
const source = await import('../../services/utils/fifa-source.js');
const readSourcePage = jest.fn();
jest.unstable_mockModule('../../services/utils/fifa-source.js', () => ({...source, readSourcePage}));
const {FifaService} = await import('../../services/fifa-service.js');
const {memberOfFifa} = await import('../../services/utils/fifa-members.js');

const jp = memberOfFifa('JPN');
const SUBJECT = {qid: 'Q124138', name: 'Gianni Infantino', terms: ['infantino']};
const SENTENCE = `The ${jp.association} will back Infantino for a new term, its president said.`;
const vote = (more = {}) => ({id: 5, user_id: 7, subject_qid: SUBJECT.qid, member_qid: jp.qid, value: 'for', source_url: 'https://www.example.com/news/a', ...more});
const page = (text) => ({title: 'JFA backs Infantino', description: '', text, lang: 'en', publishedAt: '2026-11-10T08:00:00Z'});
const label = (more = {}) => ({about_election: true, association_ok: 'yes', speaker_kind: 'president', stance: 'for', toward: 'person', mark: 'official', level: 'declared', status: 'established',
    reason: '', confidence: 'high', note: '', quote: 'will back Infantino', speaker: 'Someone', ...more});

beforeEach(() => {
    for (const fn of Object.values(model)) fn.mockReset();
    readSourcePage.mockReset();
    ollamaJson.mockReset();
    model.subjects.mockResolvedValue([SUBJECT]);
    model.voteById.mockResolvedValue(vote());
    model.setSourceCheck.mockResolvedValue(1);
    model.expireSources.mockResolvedValue(0);
    model.pendingSources.mockResolvedValue([]);
    readSourcePage.mockResolvedValue(page(SENTENCE));
    ollamaJson.mockResolvedValue(label());
});

describe('FifaService.checkSource', () => {
    it('should keep "says" with the sentence when the page says what the reader chose, read by both models as the news are', async () => {
        expect(await FifaService.checkSource(5)).toBe('says');
        expect(model.setSourceCheck).toHaveBeenCalledWith(5, {check: 'says', found: SENTENCE});
        expect(ollamaJson).toHaveBeenCalledTimes(2);
    });

    it('should keep "contradicts" when the page says the other thing', async () => {
        ollamaJson.mockResolvedValue(label({stance: 'against'}));
        expect(await FifaService.checkSource(5)).toBe('contradicts');
        expect(model.setSourceCheck).toHaveBeenCalledWith(5, expect.objectContaining({check: 'contradicts'}));
    });

    it('should expect the side of the vote: a vote AGAINST that the page backs is contradicted', async () => {
        model.voteById.mockResolvedValue(vote({value: 'against'}));
        expect(await FifaService.checkSource(5)).toBe('contradicts');
    });

    it('should keep "unclear" with no AI call when the page does not name the association and the candidate in one sentence', async () => {
        readSourcePage.mockResolvedValue(page('The weather was fine in Tokyo. Infantino spoke in Zurich.'));
        expect(await FifaService.checkSource(5)).toBe('unclear');
        expect(ollamaJson).not.toHaveBeenCalled();
    });

    it('should keep "unclear" when the readings are not established (a passage that is no position)', async () => {
        ollamaJson.mockResolvedValue(label({status: 'uncertain', reason: 'praise'}));
        expect(await FifaService.checkSource(5)).toBe('unclear');
    });

    it('should keep "unreadable" when the page cannot be read: an answer that is no article, or a fetch that fails', async () => {
        readSourcePage.mockResolvedValue(null);
        expect(await FifaService.checkSource(5)).toBe('unreadable');
        readSourcePage.mockRejectedValue(new Error('timeout'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await FifaService.checkSource(5)).toBe('unreadable');
        warn.mockRestore();
        expect(model.setSourceCheck).toHaveBeenCalledTimes(2);
    });

    it('should leave the check pending when the AI gave no reading, so that the watch makes it again', async () => {
        ollamaJson.mockResolvedValue({nonsense: true});
        expect(await FifaService.checkSource(5)).toBeNull();
        expect(model.setSourceCheck).not.toHaveBeenCalled();
    });

    it('should do nothing for a vote that has no source or does not exist, and never change a position (it only writes the check)', async () => {
        model.voteById.mockResolvedValue(vote({source_url: ''}));
        expect(await FifaService.checkSource(5)).toBeNull();
        model.voteById.mockResolvedValue(null);
        expect(await FifaService.checkSource(6)).toBeNull();
        expect(model.setSourceCheck).not.toHaveBeenCalled();
    });

    it('should not make the same check twice at once', async () => {
        let release;
        readSourcePage.mockReturnValue(new Promise(resolve => { release = () => resolve(page(SENTENCE)); }));
        const first = FifaService.checkSource(5);
        await new Promise(resolve => setImmediate(resolve));
        expect(await FifaService.checkSource(5)).toBeNull();
        release();
        expect(await first).toBe('says');
        expect(readSourcePage).toHaveBeenCalledTimes(1);
    });
});
