// labels the new words change, and the language of each feed by feedLanguage
import 'dotenv/config';
import pg from 'pg';
import {feedLanguage, languageOf} from '../../services/utils/language.js';
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows} = await client.query(`
    SELECT a.id, a.title, left(a.description, 400) AS d, a.lang, f.url,
           (SELECT uf.language FROM user_feeds uf WHERE uf.url = f.url LIMIT 1) AS declared
    FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.lang IS NOT NULL AND a.created_at > now() - interval '3 days' ORDER BY a.id DESC`);
await client.end();
const moved = rows.filter(r => ['nl', 'pt', 'cs', 'pl'].includes(languageOf(`${r.title} ${r.d ?? ''}`, r.lang)));
console.log(`${rows.length} news, ${moved.length} now told nl/pt`);
const byFeed = new Map();
for (const r of moved) byFeed.set(r.url, [...(byFeed.get(r.url) ?? []), r.title.slice(0, 70)]);
for (const [url, titles] of [...byFeed].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) console.log(titles.length, url.slice(0, 80), '|', titles[0]);
const feeds = new Map();
for (const r of rows.filter(r => !r.url.includes('news.google.com'))) {
    const f = feeds.get(r.url) ?? {declared: r.declared, texts: []};
    f.texts.push(`${r.title} ${r.d ?? ''}`);
    feeds.set(r.url, f);
}
const table = [...feeds].map(([url, f]) => ({url: url.slice(0, 70), declared: f.declared, told: feedLanguage(f.texts), n: f.texts.length}));
console.log(`${table.length} feeds: ${table.filter(t => t.told === null).length} untold`);
console.table(table.filter(t => t.told === null || (t.declared && t.told !== t.declared) || ['nl', 'pt', 'cs', 'pl'].includes(t.told)));
