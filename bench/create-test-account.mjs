// a reader for the live tests, with a generated password written to bench/test-account.local.md
// node bench/create-test-account.mjs <username>
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import bcrypt from 'bcrypt';

const username = process.argv[2];
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [same]} = await client.query('SELECT id FROM users WHERE username = $1', [username]);
if (same) throw new Error(`${username} exists already (id ${same.id})`);
const {rows: [model]} = await client.query(`SELECT role FROM users WHERE username = 'lecteur-test'`);
const password = crypto.randomBytes(12).toString('base64url');
const {rows: [user]} = await client.query('INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, `${username}@example.test`, await bcrypt.hash(password, 12), model.role]);
await client.end();
fs.appendFileSync(new URL('./test-account.local.md', import.meta.url),
    `\nCreated ${new Date().toISOString()} for the live tests, user id ${user.id}.\n\n- username: ${username}\n- password: ${password}\n`);
console.log(`user ${user.id} created, password in bench/test-account.local.md`);
