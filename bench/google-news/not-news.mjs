// the news of Google News the rule of isNotNews leaves out, on what is stored
import 'dotenv/config';
import pg from 'pg';
import {isNotNews} from '../../services/utils/google-news.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`SELECT a.id, a.title, a.resolved_link FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url LIKE 'https://news.google.com/%'`);
const out = rows.filter(r => isNotNews(r.title, r.resolved_link));
console.log(`${rows.length} news of Google News, ${out.length} left out`);
for (const r of out) console.log('-', r.title.slice(0, 110), r.resolved_link ? `(${r.resolved_link.slice(0, 60)})` : '');
if (process.argv.includes('--delete')) {
    const {rowCount} = await client.query('DELETE FROM articles WHERE id = ANY($1::int[])', [out.map(r => r.id)]);
    console.log(`${rowCount} deleted`);
}
await client.end();
