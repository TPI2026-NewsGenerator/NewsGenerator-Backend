// the why and the start of the summary of each card of a briefing: node bench/why.mjs <briefingId>
import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT item->>'why' AS why, item->>'summary' AS summary FROM briefings, jsonb_array_elements(items) item WHERE id = $1`, [Number(process.argv[2])]);
await client.end();
rows.forEach((r, i) => console.log(`${i} why: ${r.why}\n  ${(r.summary ?? '(none)').replace(/\s+/g, ' ').slice(0, 220)}`));
