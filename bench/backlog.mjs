// news of the window with vectors and no story yet: node --env-file=.env bench/backlog.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
console.log((await c.query(`SELECT count(*) FILTER (WHERE id_story IS NULL) AS ungrouped, count(*) AS total FROM articles
    WHERE embedded_at IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '48 hours'`)).rows[0]);
await c.end();
