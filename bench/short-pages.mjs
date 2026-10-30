// how many pages read give a text too short to summarize (canSummarize), on the articles of a search
// node bench/short-pages.mjs <regex> [days]
import 'dotenv/config';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize} from '../services/utils/ollama.js';
const [pattern = 'PSG', days = 7] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`SELECT DISTINCT ON (link) link, medium FROM articles WHERE search_text ~* $1 AND created_at > now() - make_interval(days => $2::int) AND link NOT LIKE 'https://news.google.com/%' ORDER BY link LIMIT 60`, [pattern, days]);
await c.end();
const pages = new Map((await Crawlers.Html(rows.map(r => r.link))).map(p => [p.url, p]));
const count = (t) => (t ?? '').split(/\s+/).filter(Boolean).length;
const byMedium = new Map();
for (const r of rows) {
    const n = count(pages.get(r.link)?.content);
    const m = byMedium.get(r.medium) ?? []; m.push(n); byMedium.set(r.medium, m);
}
const all = [...byMedium.values()].flat();
console.log(`${rows.length} articles: ${all.filter(n => n >= 150).length} summarizable, ${all.filter(n => n > 0 && n < 150).length} short, ${all.filter(n => n === 0).length} unread`);
for (const [m, list] of [...byMedium].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${m}: ${list.join(' ')}`);
process.exit(0);
