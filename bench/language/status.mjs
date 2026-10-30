import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: [r]} = await client.query(`SELECT discovery_status FROM user_profiles WHERE id_user = 129`);
await client.end();
console.log(r.discovery_status);
