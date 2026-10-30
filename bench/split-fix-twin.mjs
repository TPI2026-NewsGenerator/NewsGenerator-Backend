// The new stories of split-mixed-stories.mjs shared by matches that are not the same (the twin check
// before its fix only asked "not shown different": "Penn State MSOC vs. Ohio State" joined "Penn State vs.
// Wisconsin" in #157546): the first match keeps the story, each other one gets a story of its own
// node --env-file=.env bench/split-fix-twin.mjs <backup.json> [--apply]
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const {plan} = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const same = (p, q) => p.teams.every(t => q.names.some(n => n.startsWith(t))) && q.teams.every(t => p.names.some(n => n.startsWith(t)));

const fixes = [];
for (const [to, shared] of Map.groupBy(plan.filter(p => !p.target), p => p.to)) {
    if (shared.length < 2) continue;
    // the matches of the story, in the order they came: a plan entry joins the first match it is
    const matches = [];
    for (const p of shared) {
        const m = matches.find(g => same(g[0], p));
        if (m) m.push(p); else matches.push([p]);
    }
    console.log(`#${to}: ${matches.map(g => `"${g[0].match.slice(0, 50)}" (${g.flatMap(p => p.news).length} news)`).join(' | ')}`);
    for (const g of matches.slice(1)) fixes.push({from: to, lang: g[0].lang, match: g[0].match, news: g.flatMap(p => p.news), at: Math.max(...g.map(p => p.at))});
}

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
for (const f of fixes) {
    const still = (await c.query('SELECT count(*)::int AS n FROM articles WHERE id = ANY($1) AND id_story = $2', [f.news, f.from])).rows[0].n;
    console.log(`  ${still}/${f.news.length} news "${f.match.slice(0, 60)}" still in #${f.from} -> new story`);
}
if (APPLY && fixes.length) {
    const before = (await c.query('SELECT id, id_story FROM articles WHERE id = ANY($1)', [fixes.flatMap(f => f.news)])).rows;
    const backup = `bench/data/matchups/split-fix-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(backup, JSON.stringify({fixes, before}, null, 1));
    await c.query('BEGIN');
    try {
        for (const f of fixes) {
            f.to = (await c.query('INSERT INTO stories (lang, updated_at, grouped_at) VALUES ($1, $2, now()) RETURNING id', [f.lang, new Date(f.at)])).rows[0].id;
            await c.query('UPDATE articles SET id_story = $1 WHERE id = ANY($2) AND id_story = $3', [f.to, f.news, f.from]);
        }
        const touched = [...new Set(fixes.flatMap(f => [f.from, f.to]))];
        await c.query(`
            UPDATE stories s SET updated_at = COALESCE(m.at, s.updated_at), grouped_at = now()
            FROM (SELECT x.id, (SELECT max(COALESCE(a.published_at, a.created_at)) FROM articles a WHERE a.id_story = x.id) AS at
                  FROM unnest($1::int[]) AS x(id)) m
            WHERE s.id = m.id`, [touched]);
        await c.query('COMMIT');
        fs.writeFileSync(backup, JSON.stringify({fixes, before}, null, 1));
        console.log(`applied; backup in ${backup}`);
    } catch (err) {
        await c.query('ROLLBACK');
        throw err;
    }
}
await c.end();
