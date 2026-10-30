// the Dutch feed discovery gave the test reader (user 129), removed to find its sources again
import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rowCount} = await client.query(`DELETE FROM user_feeds WHERE id_user = 129 AND origin = 'profile' AND url LIKE '%favorflav.com/nl/%'`);
const {rows} = await client.query(`SELECT url, language, created_at FROM user_feeds WHERE id_user = 129 ORDER BY id`);
await client.end();
console.log(`${rowCount} removed`); console.table(rows);
