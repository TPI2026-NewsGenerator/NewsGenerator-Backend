// A fixed sample of the stories of several media lasting more than a day, to judge drift by hand
// node bench/story-drift-sample.mjs  ->  bench/data/story-drift/sample.json + sample.txt
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const OUT = 'bench/data/story-drift';
fs.mkdirSync(OUT, {recursive: true});
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows: stories} = await c.query(`
  WITH s AS (SELECT id_story, count(DISTINCT medium) media,
                    extract(epoch FROM max(COALESCE(published_at, created_at)) - min(COALESCE(published_at, created_at))) / 3600 AS hours
             FROM articles WHERE id_story IS NOT NULL AND COALESCE(published_at, created_at) > now() - interval '7 days'
             GROUP BY id_story HAVING count(DISTINCT medium) >= 2)
  (SELECT id_story, hours, '24-48h' band FROM s WHERE hours >= 24 AND hours < 48 ORDER BY md5(id_story::text) LIMIT 20)
  UNION ALL
  (SELECT id_story, hours, '48h+' band FROM s WHERE hours >= 48 ORDER BY md5(id_story::text) LIMIT 20)`);
const out = [];
let txt = '';
for (const [i, s] of stories.entries()) {
    const {rows} = await c.query(`SELECT id, to_char(COALESCE(published_at, created_at), 'DD HH24:MI') at, medium, lang, left(title, 110) title
        FROM articles WHERE id_story = $1 ORDER BY COALESCE(published_at, created_at), id`, [s.id_story]);
    out.push({story: s.id_story, band: s.band, hours: Math.round(s.hours), members: rows});
    txt += `\n#${i} story ${s.id_story} ${s.band} (${Math.round(s.hours)} h, ${rows.length} news, ${rows[0].lang})\n`;
    for (const r of rows.slice(0, 30)) txt += `  ${r.at} ${r.title} [${r.medium}]\n`;
    if (rows.length > 30) txt += `  ... ${rows.length - 30} more\n`;
}
fs.writeFileSync(`${OUT}/sample.json`, JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/sample.txt`, txt);
console.log(stories.length, 'stories');
await c.end();
