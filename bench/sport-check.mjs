//
//  Author: Fabian Rostello
//  Date: 12.11.2026
//  File: sport-check.mjs
//  Description: The check of the sport of the cards written (services/utils/sport-check.js) run on briefings already written, to read what it would leave out: the
//               cards of another sport than the profile's. Read only, nothing saved.
//
//  node --env-file=.env bench/sport-check.mjs file <cards.json> <profileId>       a briefing never saved (bench/enzo-measure.mjs writes it)
//  node --env-file=.env bench/sport-check.mjs saved <profileId...> [since=2026-11-04]   the saved briefings of these profiles since a date
//

import process from 'node:process';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {wrongSportOf} from '../services/utils/sport-check.js';
import {newUsage} from '../services/utils/ollama.js';

const [mode, ...args] = process.argv.slice(2);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const profileText = async (id) => (await client.query('SELECT text FROM user_profiles WHERE id = $1', [id])).rows[0]?.text;
const usage = newUsage();
const quiet = {log: () => {}, error: console.error};
let cards = 0, flagged = 0;
const run = async (label, items, profile) => {
    const wrong = await wrongSportOf(items, profile, {usage, label, log: {log: console.log, error: console.error}});
    cards += items.length; flagged += wrong.length;
    for (const one of wrong) console.log(`   ${label}: LEFT OUT "${one.title.slice(0, 90)}" -> ${one.sport} ("${one.evidence.slice(0, 70)}")`);
};
if (mode === 'file') {
    const [file, profileId] = args;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    await run(file, Array.isArray(data) ? data : data.cards, await profileText(Number(profileId)));
} else if (mode === 'saved') {
    const since = /^\d{4}-/.test(args.at(-1) ?? '') ? args.pop() : '2026-11-04';
    for (const profileId of args.map(Number)) {
        const profile = await profileText(profileId);
        const {rows} = await client.query(`SELECT id, items FROM briefings WHERE id_profile = $1 AND status = 'ready' AND created_at > $2 AND jsonb_typeof(items) = 'array' ORDER BY id`, [profileId, since]);
        for (const row of rows) await run(`briefing ${row.id} p${profileId}`, row.items, profile);
    }
}
console.log(`${cards} cards read, ${flagged} left out, tokens ${JSON.stringify(usage)}`);
await client.end();
process.exit(0);
