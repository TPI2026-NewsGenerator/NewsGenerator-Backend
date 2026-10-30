// run SQL files on the database of .env: node --env-file=.env bench/apply-sql.mjs <file> ...
import fs from 'node:fs';
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
for (const file of process.argv.slice(2)) {
    await c.query(fs.readFileSync(file, 'utf8'));
    console.log(`${file}: done`);
}
const {rows} = await c.query(`SELECT proname, pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname IN ('assign_stories', 'assign_threads')`);
rows.forEach(r => console.log(`${r.proname}(${r.args})`));
await c.end();
