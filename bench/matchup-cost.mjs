// What the matchup rule costs assign_stories: for recent English news naming a match, the vote of
// assign_stories on its candidate stories (here the stories whose members it resembles most on
// average, title likeness >= 0.70), read only, against the scoring query itself
// node --env-file=.env bench/matchup-cost.mjs
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const ids = (await c.query(`
  SELECT id FROM articles WHERE lang = 'en' AND created_at > now() - interval '6 hours' AND embedded_at IS NOT NULL
    AND public.matchup_of(title) IS NOT NULL ORDER BY md5(id::text) LIMIT 15`)).rows.map(r => r.id);
const scoring = [], voting = [], candidates = [];
for (const id of ids) {
    let t = performance.now();
    const stories = (await c.query(`
      SELECT m.id_story, avg(-(m.title_dense <#> a.title_dense) - (m.title_sparse <#> a.title_sparse)) AS score
      FROM articles a JOIN articles m ON m.id_story IS NOT NULL AND m.lang = a.lang
           AND COALESCE(m.published_at, m.created_at) >= now() - interval '48 hours'
      WHERE a.id = $1 GROUP BY m.id_story HAVING avg(-(m.title_dense <#> a.title_dense) - (m.title_sparse <#> a.title_sparse)) >= 0.70
      ORDER BY 2 DESC`, [id])).rows;
    scoring.push(performance.now() - t);
    candidates.push(stories.length);
    t = performance.now();
    for (const s of stories) await c.query(`
      SELECT count(*) FILTER (WHERE vote.other) > count(*) FILTER (WHERE NOT vote.other) AS other_match
      FROM articles a, LATERAL (SELECT public.matchup_of(a.title) AS teams, public.title_names(a.title) AS words) t,
           LATERAL (SELECT public.different_matches(t.teams, t.words, m.title) AS other FROM articles m
                    WHERE m.id_story = $2 AND m.lang = a.lang AND COALESCE(m.published_at, m.created_at) >= now() - interval '48 hours'
                      AND m.title ~* '\s(vs\.?|v\.?|versus)\s') vote
      WHERE a.id = $1`, [id, s.id_story]);
    voting.push(performance.now() - t);
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`${ids.length} news naming a match: scoring ${median(scoring).toFixed(0)} ms, ${median(candidates)} candidate stories (max ${Math.max(...candidates)}), votes ${median(voting).toFixed(1)} ms (max ${Math.max(...voting).toFixed(0)} ms)`);
await c.end();
