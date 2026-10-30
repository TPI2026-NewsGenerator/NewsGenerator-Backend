// stories whose news are titles of a template (betting tips, predictions...) about different matches
import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const rows = (await c.query(`
  SELECT a.id_story, count(*)::int AS news, count(DISTINCT a.medium)::int AS media, count(DISTINCT a.title)::int AS titles,
         (array_agg(a.medium || ' | ' || a.title ORDER BY a.id))[1:6] AS sample
  FROM articles a
  WHERE a.id_story IN (SELECT id_story FROM articles WHERE created_at > now() - interval '7 days'
                       AND title ~* '(betting tips|prediction|pronostic|predicted line|odds|preview|vs\.? .* tips)' AND id_story IS NOT NULL)
  GROUP BY a.id_story HAVING count(DISTINCT a.title) >= 2 ORDER BY count(*) DESC LIMIT 40`)).rows;
for (const r of rows) console.log(`\n#${r.id_story} ${r.news} news, ${r.media} media, ${r.titles} titles\n  ` + r.sample.join('\n  '));
await c.end();
