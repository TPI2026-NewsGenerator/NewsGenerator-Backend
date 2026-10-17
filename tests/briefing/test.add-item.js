//
//  Author: Fabian Rostello
//  Date: 17.10.2026
//  File: test.add-item.js
//  Description: A news the reader adds to a briefing (BriefingModel.addItem): the count of the news added
//               and the links already in the briefing checked by the statement that adds it, so two
//               news added at the same time can't pass the limit nor add one link twice. The SQL of the
//               model run in the database, in a transaction rolled back
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {jest} from '@jest/globals';

// only the SQL of the model is run, by pg: the client of Prisma is not loaded
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {ADD_ITEM} = await import('../../models/briefing-model.js');

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT items, id_profile FROM briefings LIMIT 0');
} catch {
    dbAvailable = false;
    console.warn('Database not available, the tests of the news added to a briefing are skipped');
}
afterAll(() => pool.end());

const LEAD = 'https://media.example/lead';
const ARTICLE = 'https://other.example/article';

// a reader with a ready briefing of one card; rolled back whatever happens
const inTransaction = async (test) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [user]} = await client.query(
            "INSERT INTO users (username, email, password, role) VALUES ('add-item', 'add-item@test.invalid', '-', 1) RETURNING id");
        const {rows: [profile]} = await client.query(
            "INSERT INTO user_profiles (id_user, text) VALUES ($1, 'La voile.') RETURNING id", [user.id]);
        const items = [{storyId: 1, lead: {url: LEAD}, articles: [{url: LEAD}, {url: ARTICLE}]}];
        const {rows: [briefing]} = await client.query(
            "INSERT INTO briefings (id_user, id_profile, status, items) VALUES ($1, $2, 'ready', $3) RETURNING id",
            [user.id, profile.id, JSON.stringify(items)]);
        await test(client, user.id, briefing.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

const add = async (client, userId, briefingId, url, max = 2) => (await client.query(ADD_ITEM,
    [briefingId, userId, JSON.stringify({imported: true, lead: {url}, articles: [{url}]}), max, [url]])).rows[0]?.storyId ?? null;

const maybe = dbAvailable ? it : it.skip;

describe('a news added to a briefing', () => {
    maybe('should be added at the end with the next negative id', () => inTransaction(async (client, userId, briefingId) => {
        expect(await add(client, userId, briefingId, 'https://news.example/1')).toBe(-1);
        expect(await add(client, userId, briefingId, 'https://news.example/2')).toBe(-2);
    }));

    maybe('should not pass the news added at most', () => inTransaction(async (client, userId, briefingId) => {
        await add(client, userId, briefingId, 'https://news.example/1');
        await add(client, userId, briefingId, 'https://news.example/2');

        expect(await add(client, userId, briefingId, 'https://news.example/3')).toBeNull();
    }));

    maybe('should not add a link already the lead or an article of a card, nor one added already', () => inTransaction(async (client, userId, briefingId) => {
        expect(await add(client, userId, briefingId, ARTICLE)).toBeNull();
        expect(await add(client, userId, briefingId, 'https://news.example/1')).toBe(-1);
        expect(await add(client, userId, briefingId, 'https://news.example/1')).toBeNull();
    }));

    maybe('should add nothing to a briefing of another reader', () => inTransaction(async (client, userId, briefingId) => {
        expect(await add(client, userId + 100000, briefingId, 'https://news.example/1')).toBeNull();
    }));
});
