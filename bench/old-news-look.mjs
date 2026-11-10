// The news of some stories with their age now, to read what the age gate left out (node --env-file=.env bench/old-news-look.mjs 2297714 2308999)
import process from 'node:process';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
for (const id of process.argv.slice(2).map(Number)) {
    const {rows} = await c.query(`SELECT round((extract(epoch FROM now() - COALESCE(published_at, created_at)) / 86400)::numeric, 1) AS days, medium, lang, left(title, 130) AS title
        FROM articles WHERE id_story = $1 ORDER BY COALESCE(published_at, created_at)`, [id]);
    const perMedium = rows.filter((row, at) => rows.findIndex(other => other.medium === row.medium) === at);
    console.log(`story ${id}: ${rows.length} news, ${perMedium.length} media`);
    for (const row of [...perMedium.slice(0, 5), {title: '...'}, ...perMedium.slice(-6)]) console.log(`  ${row.days ?? ''} d  ${row.medium ?? ''} [${row.lang ?? ''}] ${row.title}`);
}
await c.end();
