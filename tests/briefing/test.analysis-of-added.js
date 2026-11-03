//
//  Author: Fabian Rostello
//  Date: 03.11.2026
//  File: test.analysis-of-added.js
//  Description: The analysis of a ready briefing opened again for the cards the reader adds to it (the card is read and completed
//               like the others, its analysis is written after the answer): opened only when the analysis is written, several cards
//               added in a row written together, closed when each has its answer, never lines for a card taken out meanwhile
//

import {beforeEach, describe, expect, it, jest} from '@jest/globals';

// the row of the briefing the statement reads and the analysis it writes, in place of the database
let row = null;
const queried = jest.fn(async () => (row ? [row] : []));
const written = jest.fn(async (sql, id, json) => { row = {...row, analysis: JSON.parse(json)}; });
const tx = {$queryRawUnsafe: queried, $executeRawUnsafe: written};
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {$transaction: async (work) => work(tx)}}));
const {BriefingModel} = await import('../../models/briefing-model.js');

const ready = (extra = {}) => ({status: 'ready', model: 'm', picked: [{storyId: 3, reason: 'a'}], cards: {3: {why: ['One.'], next: [], timeline: []}}, startedAt: 'T', ...extra});
const lines = {why: ['Two.'], next: [], timeline: []};

beforeEach(() => {
    row = {analysis: ready(), items: [{storyId: 3}, {storyId: -1}, {storyId: -2}]};
    queried.mockClear();
    written.mockClear();
});

describe('BriefingModel.startAnalysisOfAdded', () => {
    it('should open a written analysis again with the card among the cards picked', async () => {
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -1)).toBe(1);
        expect(row.analysis).toMatchObject({status: 'running', importing: 1, picked: [{storyId: 3, reason: 'a'}, {storyId: -1, reason: null}]});
        // the lines of the other cards stay
        expect(row.analysis.cards[3]).toBeDefined();
        expect(row.analysis.beatAt).toEqual(expect.any(String));
    });

    it('should count a second card added while the first is written, together with it', async () => {
        await BriefingModel.startAnalysisOfAdded(4, 7, -1);
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -2)).toBe(1);
        expect(row.analysis).toMatchObject({status: 'running', importing: 2});
        expect(row.analysis.picked.map(entry => entry.storyId)).toEqual([3, -1, -2]);
    });

    it('should not touch an analysis the server is still writing for the briefing itself, nor one that failed or is missing', async () => {
        row.analysis = ready({status: 'running'});
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -1)).toBe(0);
        row.analysis = {status: 'failed'};
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -1)).toBe(0);
        row.analysis = null;
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -1)).toBe(0);
        row = null;
        expect(await BriefingModel.startAnalysisOfAdded(4, 7, -1)).toBe(0);
        expect(written).not.toHaveBeenCalled();
    });
});

describe('BriefingModel.finishAnalysisOfAdded', () => {
    it('should save the lines of the card and close the analysis once it was the only one written', async () => {
        await BriefingModel.startAnalysisOfAdded(4, 7, -1);
        expect(await BriefingModel.finishAnalysisOfAdded(4, 7, -1, lines)).toBe(1);
        expect(row.analysis.status).toBe('ready');
        expect(row.analysis.cards[-1]).toEqual(lines);
        expect(row.analysis.cards[3]).toBeDefined();
        expect(row.analysis).not.toHaveProperty('importing');
        expect(row.analysis).not.toHaveProperty('beatAt');
        expect(row.analysis.picked.map(entry => entry.storyId)).toEqual([3, -1]);
    });

    it('should stay running until every card added has its answer', async () => {
        await BriefingModel.startAnalysisOfAdded(4, 7, -1);
        await BriefingModel.startAnalysisOfAdded(4, 7, -2);
        await BriefingModel.finishAnalysisOfAdded(4, 7, -2, lines);
        expect(row.analysis).toMatchObject({status: 'running', importing: 1});
        await BriefingModel.finishAnalysisOfAdded(4, 7, -1, null);
        expect(row.analysis.status).toBe('ready');
        // the card with none is no more among the cards picked, the other keeps its lines
        expect(row.analysis.picked.map(entry => entry.storyId)).toEqual([3, -2]);
        expect(Object.keys(row.analysis.cards).sort()).toEqual(['-2', '3']);
    });

    it('should keep no lines for a card taken out of the briefing meanwhile', async () => {
        await BriefingModel.startAnalysisOfAdded(4, 7, -1);
        row.items = [{storyId: 3}];
        await BriefingModel.finishAnalysisOfAdded(4, 7, -1, lines);
        expect(row.analysis.cards[-1]).toBeUndefined();
        expect(row.analysis.picked.map(entry => entry.storyId)).toEqual([3]);
        expect(row.analysis.status).toBe('ready');
    });

    it('should do nothing when the briefing has no analysis of cards added running', async () => {
        expect(await BriefingModel.finishAnalysisOfAdded(4, 7, -1, lines)).toBe(0);
        row.analysis = ready({status: 'running'});
        expect(await BriefingModel.finishAnalysisOfAdded(4, 7, -1, lines)).toBe(0);
        expect(written).not.toHaveBeenCalled();
    });
});
