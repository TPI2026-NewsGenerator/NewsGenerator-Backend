// the cards of a test reader set back to not seen, so the next briefing chooses from the same stories
// node bench/unsee.mjs <userId>
import 'dotenv/config';
import pg from 'pg';
const userId = Number(process.argv[2]);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rowCount} = await client.query(`
    UPDATE briefings SET items = (SELECT jsonb_agg(item || '{"seenAt": null}'::jsonb ORDER BY position)
                                  FROM jsonb_array_elements(items) WITH ORDINALITY AS cards(item, position))
    WHERE id_user = $1 AND status = 'ready' AND jsonb_array_length(items) > 0`, [userId]);
await client.end();
console.log(`${rowCount} briefings of user ${userId} set back to not seen`);
