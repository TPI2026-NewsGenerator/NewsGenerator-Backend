// matchup_of and different_matches of the database against bench/matchup-replay.py, on the exported titles
// node --env-file=.env bench/matchup-sql-check.mjs  (after: python bench/matchup-replay.py --dump)
import fs from 'node:fs';
import pg from 'pg';
const py = JSON.parse(fs.readFileSync('bench/data/matchups/python-matchups.json', 'utf8'));
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const ids = py.titles.map(t => t.id);
const rows = (await c.query(`SELECT id, public.matchup_of(title) AS teams FROM articles WHERE id = ANY($1)`, [ids])).rows;
const sql = new Map(rows.map(r => [r.id, r.teams ? r.teams.join(',') : null]));
let same = 0, diff = [];
for (const t of py.titles) { const s = sql.get(t.id) ?? null; if (s === t.teams) same++; else diff.push({title: t.title, py: t.teams, sql: s}); }
console.log(`matchup_of: ${same}/${py.titles.length} as Python`); diff.slice(0, 15).forEach(d => console.log('  ', d.py, '|', d.sql, '|', d.title));
const pairs = (await c.query(`
    SELECT p.k, public.different_matches(public.matchup_of(a.title), public.title_names(a.title), b.title) AS different
    FROM jsonb_to_recordset($1::jsonb) AS p(k int, a int, b int) JOIN articles a ON a.id = p.a JOIN articles b ON b.id = p.b`,
    [JSON.stringify(py.pairs.map((p, k) => ({k, a: p.a, b: p.b})))])).rows;
let agree = 0; const bad = [];
for (const r of pairs) { const p = py.pairs[r.k]; if ((r.different ?? null) === p.different) agree++; else bad.push({...p, sql: r.different}); }
console.log(`different_matches: ${agree}/${pairs.length} as Python`); bad.slice(0, 10).forEach(b => console.log('  ', b));
await c.end();
