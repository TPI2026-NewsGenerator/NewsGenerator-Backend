//
//  Author: Fabian Rostello
//  Date: 07.10.2026
//  File: test.removed-sources.js
//  Description: Tests of the sources found for a profile the reader removes and brings back: the SQL of
//               ProfileModel run in the database, in a transaction rolled back
//

import process from 'node:process'
import 'dotenv/config';
import pg from 'pg';
import {jest} from '@jest/globals';

// only the SQL of the model is run, by pg: the client of Prisma is not loaded
jest.unstable_mockModule('../../config/db.js', () => ({prisma: {}}));
const {REMOVE_PROFILE_FEED, RESTORE_PROFILE_FEED} = await import('../../models/profile-model.js');

const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
let dbAvailable = true;
try {
    await pool.query('SELECT removed_sources FROM user_profiles LIMIT 0');
} catch {
    dbAvailable = false;
    console.warn('Database or db/add_trusted_sources.sql not available, the removed sources tests are skipped');
}
afterAll(() => pool.end());

const FOUND = 'https://found.invalid/rss';
const OWN = 'https://own.invalid/rss';

// a reader with a profile, a feed found for it and one added by hand; rolled back whatever happens
const inTransaction = async (test) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {rows: [user]} = await client.query(
            "INSERT INTO users (username, email, password, role) VALUES ('removed-sources', 'removed-sources@test.invalid', '-', 1) RETURNING id");
        await client.query("INSERT INTO user_profiles (id_user, text) VALUES ($1, 'La voile.')", [user.id]);
        const {rows: [found, own]} = await client.query(`
            INSERT INTO user_feeds (id_user, url, site, category, language, origin)
            VALUES ($1, $2, 'found.invalid', 'sport', 'fr', 'profile'), ($1, $3, 'own.invalid', 'world', NULL, 'user')
            RETURNING id`, [user.id, FOUND, OWN]);
        await test(client, user.id, found.id, own.id);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
};

const feedsOf = async (client, userId) => (await client.query(
    'SELECT url, site, category, language, origin FROM user_feeds WHERE id_user = $1 ORDER BY url', [userId])).rows;
const removedOf = async (client, userId) => (await client.query(
    'SELECT removed_sources FROM user_profiles WHERE id_user = $1', [userId])).rows[0].removed_sources;

const maybe = dbAvailable ? it : it.skip;

describe('the sources found for a profile the reader removes', () => {
    maybe('should remove a source found for the profile and remember it as it was', () => inTransaction(async (client, userId, found) => {
        const {rowCount} = await client.query(REMOVE_PROFILE_FEED, [userId, found]);

        expect(rowCount).toBe(1);
        expect((await feedsOf(client, userId)).map(feed => feed.url)).toEqual([OWN]);
        expect(await removedOf(client, userId)).toEqual([{url: FOUND, site: 'found.invalid', category: 'sport', language: 'fr'}]);
    }));

    maybe('should never remove a source added by hand, nor one of another reader', () => inTransaction(async (client, userId, found, own) => {
        expect((await client.query(REMOVE_PROFILE_FEED, [userId, own])).rowCount).toBe(0);
        expect((await client.query(REMOVE_PROFILE_FEED, [userId + 1, found])).rowCount).toBe(0);
        expect(await feedsOf(client, userId)).toHaveLength(2);
        expect(await removedOf(client, userId)).toEqual([]);
    }));

    maybe('should bring a removed source back as it was, and forget it', () => inTransaction(async (client, userId, found) => {
        await client.query(REMOVE_PROFILE_FEED, [userId, found]);
        const {rowCount} = await client.query(RESTORE_PROFILE_FEED, [userId, FOUND]);

        expect(rowCount).toBe(1);
        expect(await feedsOf(client, userId)).toEqual([
            {url: FOUND, site: 'found.invalid', category: 'sport', language: 'fr', origin: 'profile'},
            {url: OWN, site: 'own.invalid', category: 'world', language: null, origin: 'user'},
        ]);
        expect(await removedOf(client, userId)).toEqual([]);
    }));

    maybe('should bring back nothing that was not removed', () => inTransaction(async (client, userId) => {
        expect((await client.query(RESTORE_PROFILE_FEED, [userId, 'https://other.invalid/rss'])).rowCount).toBe(0);
        expect(await feedsOf(client, userId)).toHaveLength(2);
    }));
});
