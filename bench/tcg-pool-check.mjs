import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const q = async (s, p=[]) => (await c.query(s, p)).rows;
console.log(await q(`SELECT pi.category, pi.searches, up.languages FROM profile_interests pi JOIN user_profiles up ON up.id_user = pi.id_user WHERE array_to_string(pi.searches, ' ') ILIKE '%tcg%' OR array_to_string(pi.searches, ' ') ILIKE '%pok%'`));
console.log(await q(`SELECT a.title, a.medium, a.published_at, f.url FROM articles a JOIN feeds f ON f.id=a.id_feed WHERE (a.title ILIKE '%tcg%' OR a.title ILIKE '%pokémon%') AND (a.title ILIKE '%suisse%' OR a.medium LIKE '%.ch') ORDER BY a.published_at DESC LIMIT 10`));
await c.end();

