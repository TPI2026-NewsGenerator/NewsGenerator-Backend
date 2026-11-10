//
//  Author: Fabian Rostello
//  Date: 10.11.2026
//  File: test.fold-items.js
//  Description: Two cards of a briefing made one, as the reader chose (BriefingModel.foldItems): the card kept takes the place of the first of the
//               two, the other leaves with its analysis lines, and nothing happens when a card is missing. The SQL of the model run in the
//               database, in a transaction rolled back
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {jest} from '@jest/globals';

// only the SQL of the model is run, by pg: the client of Prisma is not loaded
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {FOLD_ITEMS} = await import('../../models/briefing-model.js');

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT items, id_profile, analysis FROM briefings LIMIT 0');
} catch {
    dbAvailable = false;
    console.warn('Database not available, the tests of the cards folded are skipped');
}
afterAll(() => pool.end());

// a reader with a ready briefing of four cards, the last one added by them (a negative id), and its analysis; rolled back whatever happens
const inTransaction = async (analysis, test, status = 'ready') => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [user]} = await client.query(
            "INSERT INTO users (username, email, password, role) VALUES ('fold-items', 'fold-items@test.invalid', '-', 1) RETURNING id");
        const {rows: [profile]} = await client.query("INSERT INTO user_profiles (id_user, text) VALUES ($1, 'Le football.') RETURNING id", [user.id]);
        const items = [{storyId: 1, title: 'one'}, {storyId: 2, title: 'two'}, {storyId: 3, title: 'three'}, {storyId: -1, title: 'added', imported: true}];
        const {rows: [briefing]} = await client.query(
            "INSERT INTO briefings (id_user, id_profile, status, items, analysis) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            [user.id, profile.id, status, JSON.stringify(items), analysis === null ? null : JSON.stringify(analysis)]);
        await test(client, user.id, briefing.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

const fold = async (client, userId, briefingId, keep, drop, card = {storyId: keep, title: 'kept, folded'}) => (await client.query(FOLD_ITEMS,
    [briefingId, userId, keep, drop, JSON.stringify(card)])).rows;
const read = async (client, briefingId) => (await client.query('SELECT items, analysis FROM briefings WHERE id = $1', [briefingId])).rows[0];

const maybe = dbAvailable ? it : it.skip;
const written = {status: 'ready', cards: {1: {why: ['one']}, 2: {why: ['two']}, 3: {why: ['three']}, '-1': {why: ['added']}}};

describe('two cards of a briefing made one', () => {
    maybe('should keep the card the reader chose at the place of the first of the two, and take the other out with its analysis lines', () => inTransaction(written, async (client, userId, briefingId) => {
        // the card added (the last) folded into the second: the second stays where it is
        const rows = await fold(client, userId, briefingId, 2, -1);
        expect(rows).toEqual([{at: 1}]);
        const {items, analysis} = await read(client, briefingId);
        expect(items.map(card => [card.storyId, card.title])).toEqual([[1, 'one'], [2, 'kept, folded'], [3, 'three']]);
        expect(analysis.cards).toEqual({1: {why: ['one']}, 2: {why: ['two']}, 3: {why: ['three']}});
    }));

    maybe('should put the card added where the card it replaces stood, when the reader keeps the one added', () => inTransaction(written, async (client, userId, briefingId) => {
        const rows = await fold(client, userId, briefingId, -1, 2, {storyId: -1, title: 'added, folded', imported: true});
        expect(rows).toEqual([{at: 1}]);
        const {items, analysis} = await read(client, briefingId);
        expect(items.map(card => [card.storyId, card.title])).toEqual([[1, 'one'], [-1, 'added, folded'], [3, 'three']]);
        expect(analysis.cards).toEqual({1: {why: ['one']}, 3: {why: ['three']}, '-1': {why: ['added']}});
    }));

    maybe('should do nothing when a card is not there, for the same card twice, for a briefing that is not ready or not the reader\'s', () => inTransaction(written, async (client, userId, briefingId) => {
        expect(await fold(client, userId, briefingId, 2, 99)).toEqual([]);
        expect(await fold(client, userId, briefingId, 2, 2)).toEqual([]);
        expect(await fold(client, userId + 1, briefingId, 2, -1)).toEqual([]);
        expect((await read(client, briefingId)).items).toHaveLength(4);
    }));

    maybe('should leave a briefing that is not ready as it is, and an analysis not written yet', () => inTransaction(null, async (client, userId, briefingId) => {
        expect(await fold(client, userId, briefingId, 2, -1)).toEqual([{at: 1}]);
        expect((await read(client, briefingId)).analysis).toBeNull();
    }));

    maybe('should not touch a briefing that is running', () => inTransaction(null, async (client, userId, briefingId) => {
        expect(await fold(client, userId, briefingId, 2, -1)).toEqual([]);
        expect((await read(client, briefingId)).items).toHaveLength(4);
    }, 'running'));
});
