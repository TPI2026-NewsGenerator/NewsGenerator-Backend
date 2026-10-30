// the news waiting for vectors whose text sent to the embedder holds half of a character
// (description cut at 400 UTF-16 units in the middle of an emoji)
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows} = await c.query(`SELECT id, title, description FROM articles WHERE embedded_at IS NULL AND COALESCE(published_at, created_at) > now() - interval '48 hours'`);
const bad = rows.filter(r => !`${r.title} ${(r.description ?? '').slice(0, 400)}`.isWellFormed());
console.log(`${rows.length} waiting, ${bad.length} with half a character`, bad.slice(0, 3).map(r => [r.id, r.title.slice(0, 60)]));
await c.end();
