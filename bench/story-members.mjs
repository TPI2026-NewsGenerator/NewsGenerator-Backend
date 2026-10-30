// the members of the story of an article found by its title: node bench/story-members.mjs "title start"
import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
for (const t of process.argv.slice(2)) {
    const {rows: [a]} = await c.query(`SELECT id_story FROM articles WHERE title LIKE $1 || '%' AND id_story IS NOT NULL LIMIT 1`, [t]);
    const {rows} = await c.query(`SELECT to_char(COALESCE(published_at, created_at), 'DD HH24:MI') at, medium, left(title, 100) title
        FROM articles WHERE id_story = $1 ORDER BY 1`, [a.id_story]);
    console.log(`\n== story ${a.id_story}: ${rows.length} news, ${new Set(rows.map(r => r.medium)).size} media`);
    for (const r of rows.slice(0, 40)) console.log(`  ${r.at}  ${r.title}  [${r.medium}]`);
}
await c.end();
