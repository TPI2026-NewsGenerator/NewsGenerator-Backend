// the share of the news naming each name of the results that one site wrote: a byline is of one site
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const names = [...JSON.parse(fs.readFileSync(new URL('./results.json', import.meta.url))),
    ...JSON.parse(fs.readFileSync(new URL('./results-named.json', import.meta.url)))].map(e => e.name);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows} = await db.query(`
    WITH per AS (
        SELECT m.name, regexp_replace(split_part(a.link, '/', 3), '^www\.', '') AS site, count(*)::int AS news
        FROM mentions m JOIN article_mentions am ON am.id_mention = m.id JOIN articles a ON a.id = am.id_article
        WHERE m.kind = 'person' AND m.name = ANY($1::text[]) GROUP BY 1, 2
    )
    SELECT name, max(news)::float / sum(news) AS share, (array_agg(site ORDER BY news DESC))[1] AS site, count(*)::int AS sites
    FROM per GROUP BY name`, [names]);
await db.end();
fs.writeFileSync(new URL('./sites.json', import.meta.url), JSON.stringify(Object.fromEntries(rows.map(r => [r.name, r])), null, 1));
for (const r of rows.filter(r => r.share >= 0.5)) console.log(r.name, r.share.toFixed(2), r.site, r.sites);
