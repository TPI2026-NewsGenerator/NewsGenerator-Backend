//
//  Author: Fabian Rostello
//  Date: 01.10.2026
//  File: move-bridge-feeds.js
//  Description: The feeds read through the RSS-Bridge keep the address of the bridge they were built
//               on. When the bridge moves (the server went from the laptop, 127.0.0.1:3002, to its
//               container on the Ubuntu machine, rss-bridge), they are rewritten on the new one: else
//               the new server refuses them as private addresses that are not its bridge
//
//  node scripts/move-bridge-feeds.js <old origin> [new origin, RSS_BRIDGE_URL by default]
//  node scripts/move-bridge-feeds.js http://127.0.0.1:3002 http://rss-bridge
//

import 'dotenv/config';
import process from 'node:process';
import pg from 'pg';

const [from, to = process.env.RSS_BRIDGE_URL] = process.argv.slice(2);
const origin = (value) => {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};
if (!origin(from) || !origin(to) || origin(from) === origin(to)) {
    console.error('Give the old address of the bridge and the new one, two different origins.');
    process.exit(1);
}

const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
try {
    await client.query('BEGIN');
    // the old address and the new one, only where it starts the address
    const moved = (table) => client.query(
        `UPDATE ${table} SET url = $2 || substring(url FROM length($1) + 1) WHERE starts_with(url, $1 || '/')`,
        [origin(from), origin(to)]);
    const feeds = await moved('feeds');
    const users = await moved('user_feeds');
    await client.query('COMMIT');
    console.log(`${feeds.rowCount} feeds and ${users.rowCount} sources of readers now on ${origin(to)}`);
} catch (err) {
    await client.query('ROLLBACK');
    console.error(`Nothing changed: ${err.message}`);
    process.exitCode = 1;
} finally {
    await client.end();
}
