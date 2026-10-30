import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
console.log((await c.query(`SELECT a.link, a.source_url, a.resolved_link, a.medium FROM articles a JOIN feeds f ON f.id=a.id_feed WHERE f.url LIKE 'https://news.google.com/%' ORDER BY a.id DESC LIMIT 3`)).rows);
await c.end();
