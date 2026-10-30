// pairs of stories (two stories, not one) whose lead articles are close, among the stories told by the
// most media: the traps and the successes of the merge of the cards. Writes data/merge/pairs-raw.json,
// to be labelled by hand
// node bench/merge-pairs.mjs [days] [stories] [min cosine] [max cosine]
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [days, top, low, high] = [2, 600, 0.6, 0.95].map((value, i) => Number(process.argv[i + 2] ?? value));
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`
WITH big AS (
  SELECT id_story, count(DISTINCT medium) AS media
  FROM articles
  WHERE id_story IS NOT NULL AND title_dense IS NOT NULL AND created_at > now() - $1::int * interval '1 day'
  GROUP BY id_story ORDER BY media DESC, id_story DESC LIMIT $2
), leads AS (
  SELECT DISTINCT ON (a.id_story) a.id_story, big.media, a.title, a.medium, a.lang, a.title_dense,
         left(regexp_replace(regexp_replace(a.description, '<[^>]*>', ' ', 'g'), '\\s+', ' ', 'g'), 200) AS description
  FROM articles a JOIN big USING (id_story)
  WHERE a.title_dense IS NOT NULL
  ORDER BY a.id_story, (length(a.description) > 40) DESC, a.published_at DESC NULLS LAST
)
SELECT x.id_story AS a, y.id_story AS b, 1 - (x.title_dense <=> y.title_dense) AS cos,
       x.title AS ta, x.description AS da, x.medium AS ma, x.lang AS la, x.media AS na,
       y.title AS tb, y.description AS db, y.medium AS mb, y.lang AS lb, y.media AS nb
FROM leads x JOIN leads y ON x.id_story < y.id_story
WHERE 1 - (x.title_dense <=> y.title_dense) BETWEEN $3 AND $4
ORDER BY cos DESC`, [days, top, low, high]);
await client.end();
fs.mkdirSync(new URL('./data/merge/', import.meta.url), {recursive: true});
fs.writeFileSync(new URL('./data/merge/pairs-raw.json', import.meta.url),
    JSON.stringify(rows.map(row => ({...row, cos: Number(Number(row.cos).toFixed(3))})), null, 1));
console.log(rows.length, 'pairs');
