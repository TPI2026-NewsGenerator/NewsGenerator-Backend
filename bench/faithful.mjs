import pg from 'pg';
import {pathToFileURL} from 'node:url';
const {Crawlers} = await import(pathToFileURL(process.cwd() + '/services/utils/crawlers.js').href);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`SELECT DISTINCT ON (link) link, title, summary FROM articles WHERE summary_language = 'French' ORDER BY link`);
await c.end();
const pages = await Crawlers.Html(rows.map(r => r.link));
for (const r of rows) {
  const p = pages.find(x => x.url === r.link);
  console.log(`\n######## ${r.title}\n--- SUMMARY\n${r.summary}\n--- ARTICLE (${(p?.content ?? '').length} chars)\n${(p?.content ?? '').replace(/\s+/g, ' ').slice(0, 6000)}`);
}
process.exit(0);
