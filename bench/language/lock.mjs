import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [r]} = await client.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = hashtext('newsgenerator-ingest')::oid`);
await client.end();
console.log(r.n);
