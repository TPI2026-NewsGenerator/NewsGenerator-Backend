import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [b]} = await client.query(`SELECT id, status, step, error, jsonb_array_length(items) AS cards, round(extract(epoch FROM finished_at - created_at)) AS seconds FROM briefings WHERE id_user = $1 ORDER BY id DESC LIMIT 1`, [Number(process.argv[2] ?? 129)]);
await client.end();
console.log(JSON.stringify(b));
