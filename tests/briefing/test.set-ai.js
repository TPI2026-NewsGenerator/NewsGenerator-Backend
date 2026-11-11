//
//  Author: Fabian Rostello
//  Date: 11.11.2026
//  File: test.set-ai.js
//  Description: The AI version written for a card that had none (BriefingModel.setAi): kept in that card only, never over a version the card has,
//               only in a ready briefing of the reader. The SQL of the model run in the database, in a transaction rolled back
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {jest} from '@jest/globals';

// only the SQL of the model is run, by pg: the client of Prisma is not loaded
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {SET_AI} = await import('../../models/briefing-model.js');

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT items, id_profile FROM briefings LIMIT 0');
} catch {
    dbAvailable = false;
    console.warn('Database not available, the tests of the AI version of a card are skipped');
}
afterAll(() => pool.end());

const WRITTEN = {points: ['A point.'], summary: 'A summary.', model: 'deepseek-v4-pro:0813'};
const HAD = {points: ['Had it.'], summary: 'Had it.', model: 'gemma4:31b'};

// a reader with a briefing of three cards: one with no version (ai null), one with none at all, one with a version; rolled back whatever happens
const inTransaction = async (test, status = 'ready') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [user]} = await client.query(
            "INSERT INTO users (username, email, password, role) VALUES ('set-ai', 'set-ai@test.invalid', '-', 1) RETURNING id");
        const {rows: [profile]} = await client.query(
            "INSERT INTO user_profiles (id_user, text) VALUES ($1, 'La voile.') RETURNING id", [user.id]);
        const items = [{storyId: 1, title: 'one', ai: null}, {storyId: 2, title: 'two'}, {storyId: 3, title: 'three', ai: HAD}];
        const {rows: [briefing]} = await client.query(
            'INSERT INTO briefings (id_user, id_profile, status, items) VALUES ($1, $2, $3, $4) RETURNING id',
            [user.id, profile.id, status, JSON.stringify(items)]);
        await test(client, user.id, briefing.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

const set = async (client, userId, briefingId, storyId, ai = WRITTEN) => (await client.query(SET_AI, [briefingId, userId, storyId, JSON.stringify(ai)])).rowCount;
const itemsOf = async (client, briefingId) => (await client.query('SELECT items FROM briefings WHERE id = $1', [briefingId])).rows[0].items;

const maybe = dbAvailable ? it : it.skip;

describe('the AI version of a card that had none', () => {
    maybe('should be kept in that card only, the others and their order untouched', () => inTransaction(async (client, userId, briefingId) => {
        expect(await set(client, userId, briefingId, 1)).toBe(1);
        expect((await itemsOf(client, briefingId)).map(item => [item.storyId, item.title, item.ai])).toEqual([[1, 'one', WRITTEN], [2, 'two', undefined], [3, 'three', HAD]]);
        // a card with no field at all gets it too
        expect(await set(client, userId, briefingId, 2)).toBe(1);
        expect((await itemsOf(client, briefingId))[1].ai).toEqual(WRITTEN);
    }));

    maybe('should never replace a version the card has: the second call finds nothing to do', () => inTransaction(async (client, userId, briefingId) => {
        expect(await set(client, userId, briefingId, 3, WRITTEN)).toBe(0);
        expect((await itemsOf(client, briefingId))[2].ai).toEqual(HAD);
        expect(await set(client, userId, briefingId, 1)).toBe(1);
        expect(await set(client, userId, briefingId, 1, {points: ['Another.'], summary: null, model: 'x'})).toBe(0);
        expect((await itemsOf(client, briefingId))[0].ai).toEqual(WRITTEN);
    }));

    maybe('should do nothing for a card that is not there, another reader, or a briefing that is not ready', () => inTransaction(async (client, userId, briefingId) => {
        expect(await set(client, userId, briefingId, 99)).toBe(0);
        expect(await set(client, userId + 1, briefingId, 1)).toBe(0);
        expect(await set(client, userId, briefingId + 100000, 1)).toBe(0);
    }));

    maybe('should do nothing in a briefing still running', () => inTransaction(async (client, userId, briefingId) => {
        expect(await set(client, userId, briefingId, 1)).toBe(0);
    }, 'running'));
});
