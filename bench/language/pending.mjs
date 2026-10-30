import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [r]} = await client.query(`SELECT count(*)::int AS n FROM articles WHERE embedded_at IS NULL AND COALESCE(published_at, created_at) >= now() - interval '48 hours'`);
await client.end();
console.log(r.n);
