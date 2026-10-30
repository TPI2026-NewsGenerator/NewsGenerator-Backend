// news of the last 8 days whose title matches a pattern: node --env-file=.env bench/peek-title.mjs "<regex>"
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT a.title, f.url LIKE 'https://news.google.com/%' AS google, a.medium FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.title ~* $1 AND a.created_at > now() - interval '8 days' ORDER BY a.created_at DESC LIMIT 15`, [process.argv[2]]);
rows.forEach(r => console.log(`${r.google ? 'G' : 'F'} ${r.medium} | ${r.title.slice(0, 100)}`));
await c.end();
