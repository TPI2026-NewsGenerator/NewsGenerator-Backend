import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const urls = ['https://www.faz.net/rss/aktuell/', 'https://www.ouest-france.fr/rss-en-continu.xml', 'https://www.milannews.it/rss/', 'https://kotaku.com/rss', 'https://business.financialpost.com/feed/'];
console.log((await c.query(`SELECT f.url, count(a.id)::int AS news FROM feeds f LEFT JOIN articles a ON a.id_feed = f.id WHERE f.url = ANY($1) GROUP BY f.url`, [urls])).rows);
await c.end();
