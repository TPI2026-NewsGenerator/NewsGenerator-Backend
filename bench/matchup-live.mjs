// The news naming a match grouped since the rule (the time given), with the titles naming a match in
// their story: does a story still hold another match?
// node --env-file=.env bench/matchup-live.mjs <ISO time>
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const rows = (await c.query(`
  SELECT a.id, a.id_story, a.medium, a.title, public.matchup_of(a.title) AS teams, public.title_names(a.title) AS words,
         (SELECT count(*) FROM articles m WHERE m.id_story = a.id_story)::int AS size,
         (SELECT count(*) FILTER (WHERE public.different_matches(public.matchup_of(a.title), public.title_names(a.title), m.title))
          FROM articles m WHERE m.id_story = a.id_story AND m.id <> a.id AND m.title ~* '\s(vs\.?|v\.?|versus)\s')::int AS others,
         (SELECT count(*) FILTER (WHERE NOT public.different_matches(public.matchup_of(a.title), public.title_names(a.title), m.title))
          FROM articles m WHERE m.id_story = a.id_story AND m.id <> a.id AND m.title ~* '\s(vs\.?|v\.?|versus)\s')::int AS same
  FROM articles a WHERE a.created_at > $1 AND a.id_story IS NOT NULL AND public.matchup_of(a.title) IS NOT NULL
  ORDER BY a.id`, [process.argv[2]])).rows;
const alone = rows.filter(r => r.size === 1).length;
const mixed = rows.filter(r => r.others > 0);
console.log(`${rows.length} news naming a match grouped since ${process.argv[2]}: ${alone} alone, ${rows.length - alone} in a story; ${mixed.length} in a story holding another match`);
for (const r of mixed.slice(0, 15)) console.log(`  [${r.others} other / ${r.same} same of ${r.size}] ${r.medium} | ${r.title.slice(0, 110)}`);
console.log('\nsome joined:');
for (const r of rows.filter(r => r.size > 1 && r.others === 0).slice(0, 12)) {
    const mates = (await c.query(`SELECT title FROM articles WHERE id_story = $1 AND id <> $2 ORDER BY id DESC LIMIT 2`, [r.id_story, r.id])).rows;
    console.log(`  ${r.title.slice(0, 80)}\n      ~ ${mates.map(m => m.title.slice(0, 70)).join(' // ')}`);
}
await c.end();
