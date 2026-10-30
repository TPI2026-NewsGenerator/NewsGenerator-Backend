import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const conflicts = JSON.parse(fs.readFileSync('bench/data/matchups/conflicts.json', 'utf8'));
console.log((await c.query(`SELECT count(*) FILTER (WHERE COALESCE(published_at, created_at) < now() - interval '48 hours')::int AS older,
  count(*)::int AS all FROM articles WHERE embedded_at IS NOT NULL AND id_story IS NULL AND created_at > now() - interval '5 days'`)).rows[0]);
await c.end();
