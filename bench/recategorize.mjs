// the category of the sections of the directory read again from their address (sectionCategory)
import process from 'node:process';
import pg from 'pg';
import {sectionCategory} from '../services/directory-service.js';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const rows = (await c.query(`SELECT url FROM directory_feeds WHERE origin = 'section'`)).rows;
for (const {url} of rows) await c.query('UPDATE directory_feeds SET category = $2 WHERE url = $1', [url, sectionCategory(url)]);
console.log((await c.query(`SELECT category, count(*) FROM directory_feeds WHERE origin = 'section' GROUP BY 1 ORDER BY 2 DESC`)).rows);
await c.end();
process.exit(0);
