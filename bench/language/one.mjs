import 'dotenv/config';
import pg from 'pg';
import {languageOf} from '../../services/utils/language.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT a.title, left(a.description, 200) AS d, a.lang FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url LIKE $1 ORDER BY a.id DESC LIMIT 12`, [process.argv[2]]);
await client.end();
for (const r of rows) console.log(r.lang, languageOf(`${r.title} ${r.d ?? ''}`), '|', r.title.slice(0, 80));
