//
//  Author: Fabian Rostello
//  Date: 09.11.2026
//  File: test.replace-card.js
//  Description: A card of a briefing replaced by another version of its news (BriefingModel.replaceCard): at the same place, the analysis
//               lines of the card set or taken off only when the analysis is written. The SQL of the model run in the database, in a
//               transaction rolled back
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {jest} from '@jest/globals';

// only the SQL of the model is run, by pg: the client of Prisma is not loaded
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {REPLACE_CARD} = await import('../../models/briefing-model.js');

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT items, id_profile, analysis FROM briefings LIMIT 0');
} catch {
    dbAvailable = false;
    console.warn('Database not available, the tests of the card replaced are skipped');
}
afterAll(() => pool.end());

// a reader with a ready briefing of three cards and its analysis; rolled back whatever happens
const inTransaction = async (analysis, test) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [user]} = await client.query(
            "INSERT INTO users (username, email, password, role) VALUES ('replace-card', 'replace-card@test.invalid', '-', 1) RETURNING id");
        const {rows: [profile]} = await client.query("INSERT INTO user_profiles (id_user, text) VALUES ($1, 'Le football.') RETURNING id", [user.id]);
        const items = [{storyId: 1, title: 'one'}, {storyId: 2, title: 'two'}, {storyId: 3, title: 'three'}];
        const {rows: [briefing]} = await client.query(
            "INSERT INTO briefings (id_user, id_profile, status, items, analysis) VALUES ($1, $2, 'ready', $3, $4) RETURNING id",
            [user.id, profile.id, JSON.stringify(items), analysis === null ? null : JSON.stringify(analysis)]);
        await test(client, user.id, briefing.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

const replace = async (client, userId, briefingId, storyId, card, lines = null, setLines = false) => (await client.query(REPLACE_CARD,
    [briefingId, userId, storyId, JSON.stringify(card), lines === null ? null : JSON.stringify(lines), setLines])).rowCount;
const read = async (client, briefingId) => (await client.query('SELECT items, analysis FROM briefings WHERE id = $1', [briefingId])).rows[0];

const maybe = dbAvailable ? it : it.skip;
const written = {status: 'ready', cards: {1: {why: ['one']}, 2: {why: ['two']}, 3: {why: ['three']}}};

describe('a card replaced in a briefing', () => {
    maybe('should be replaced where it stands, the others as they were', () => inTransaction(written, async (client, userId, briefingId) => {
        expect(await replace(client, userId, briefingId, 2, {storyId: 2, title: 'two, by another profile'})).toBe(1);
        const {items} = await read(client, briefingId);
        expect(items.map(card => card.title)).toEqual(['one', 'two, by another profile', 'three']);
    }));

    maybe('should set the analysis lines of the card, or take them off, when they are asked for', () => inTransaction(written, async (client, userId, briefingId) => {
        await replace(client, userId, briefingId, 2, {storyId: 2, title: 'b'}, {why: ['theirs']}, true);
        expect((await read(client, briefingId)).analysis.cards).toEqual({1: {why: ['one']}, 2: {why: ['theirs']}, 3: {why: ['three']}});

        await replace(client, userId, briefingId, 2, {storyId: 2, title: 'a'}, null, true);
        expect((await read(client, briefingId)).analysis.cards).toEqual({1: {why: ['one']}, 3: {why: ['three']}});
    }));

    maybe('should leave the analysis alone when no lines are asked for, or when it is not written yet', () => inTransaction(written, async (client, userId, briefingId) => {
        await replace(client, userId, briefingId, 2, {storyId: 2, title: 'b'}, {why: ['theirs']}, false);
        expect((await read(client, briefingId)).analysis).toEqual(written);
    }));

    maybe('should not touch the analysis of a briefing without one', () => inTransaction(null, async (client, userId, briefingId) => {
        expect(await replace(client, userId, briefingId, 2, {storyId: 2, title: 'b'}, {why: ['theirs']}, true)).toBe(1);
        const {items, analysis} = await read(client, briefingId);
        expect(items[1].title).toBe('b');
        expect(analysis).toBeNull();
    }));

    maybe('should replace nothing of another reader, nor a card that is not there', () => inTransaction(written, async (client, userId, briefingId) => {
        expect(await replace(client, userId + 100000, briefingId, 2, {storyId: 2, title: 'b'})).toBe(0);
        expect(await replace(client, userId, briefingId, 9, {storyId: 9, title: 'b'})).toBe(0);
        expect((await read(client, briefingId)).items.map(card => card.title)).toEqual(['one', 'two', 'three']);
    }));
});
