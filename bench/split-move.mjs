// News moved by hand, read before: each move takes news out of a story into another one, or a new story
// ("to": null), backup first, one transaction, the stories touched marked grouped again
// node --env-file=.env bench/split-move.mjs <moves.json | '<json>'> [--apply]
//   the moves: [{"news": [ids], "from": story, "to": story|null}], in a file from PowerShell (Windows
//   PowerShell 5.1 takes the double quotes out of an argument given to node)
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const moves = JSON.parse(process.argv[2].endsWith('.json') ? fs.readFileSync(process.argv[2], 'utf8') : process.argv[2]);
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
for (const m of moves) {
    const rows = (await c.query('SELECT id, id_story, lang, left(title, 70) AS title, COALESCE(published_at, created_at) AS at FROM articles WHERE id = ANY($1)', [m.news])).rows;
    m.lang = rows[0].lang;
    m.at = Math.max(...rows.map(r => +r.at));
    for (const r of rows) console.log(`${r.id_story === m.from ? '' : 'NOT IN #' + m.from + ' '}#${r.id_story} "${r.title}" -> ${m.to ? '#' + m.to : 'new story'}`);
}
if (APPLY) {
    const before = (await c.query('SELECT id, id_story FROM articles WHERE id = ANY($1)', [moves.flatMap(m => m.news)])).rows;
    const backup = `bench/data/matchups/split-move-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(backup, JSON.stringify({moves, before}, null, 1));
    await c.query('BEGIN');
    try {
        for (const m of moves) {
            m.to ??= (await c.query('INSERT INTO stories (lang, updated_at, grouped_at) VALUES ($1, $2, now()) RETURNING id', [m.lang, new Date(m.at)])).rows[0].id;
            await c.query('UPDATE articles SET id_story = $1 WHERE id = ANY($2) AND id_story = $3', [m.to, m.news, m.from]);
        }
        const touched = [...new Set(moves.flatMap(m => [m.from, m.to]))];
        await c.query(`
            UPDATE stories s SET updated_at = COALESCE(x.at, s.updated_at), grouped_at = now()
            FROM (SELECT u.id, (SELECT max(COALESCE(a.published_at, a.created_at)) FROM articles a WHERE a.id_story = u.id) AS at
                  FROM unnest($1::int[]) AS u(id)) x
            WHERE s.id = x.id`, [touched]);
        await c.query('COMMIT');
        fs.writeFileSync(backup, JSON.stringify({moves, before}, null, 1));
        console.log(`applied; backup in ${backup}`);
    } catch (err) {
        await c.query('ROLLBACK');
        throw err;
    }
}
await c.end();
