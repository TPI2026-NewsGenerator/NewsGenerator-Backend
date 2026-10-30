// the words of each profile the interests saved now do not name: node bench/missing-now.mjs <username...>
import 'dotenv/config';
import pg from 'pg';
import {missingWords} from '../services/utils/profile-ai.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
for (const username of process.argv.slice(2)) {
    const {rows} = await client.query(`SELECT up.text AS profile, i.text FROM users u JOIN user_profiles up ON up.id_user = u.id JOIN profile_interests i ON i.id_user = u.id WHERE u.username = $1`, [username]);
    if (rows.length) console.log(username, '->', missingWords(rows[0].profile, rows).join(', '));
}
await client.end();
