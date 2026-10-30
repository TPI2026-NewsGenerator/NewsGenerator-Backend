import 'dotenv/config';
import pg from 'pg';
import {feedLanguage} from '../../services/utils/language.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT f.url, array_agg(a.title || ' ' || COALESCE(left(a.description, 400), '') ORDER BY a.id DESC) AS texts FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url LIKE $1 GROUP BY f.url`, [process.argv[2]]);
await client.end();
for (const r of rows) console.log(r.url, feedLanguage(r.texts), r.texts.length);
