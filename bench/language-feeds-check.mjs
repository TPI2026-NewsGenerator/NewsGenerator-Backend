// Read only: feedLanguage (language.js as it is on disk) on the last 30 news of every feed with a known
// language (user_feeds, directory_feeds), compared with that language. Run before and after a change of
// the words: node --env-file=.env bench/language-feeds-check.mjs > before.txt
import pg from 'pg';
import {feedLanguage} from '../services/utils/language.js';

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const {rows: feeds} = await c.query(`SELECT DISTINCT ON (url) url, language FROM (
    SELECT url, language FROM user_feeds WHERE language IS NOT NULL UNION ALL SELECT url, language FROM directory_feeds WHERE language IS NOT NULL) x`);
const counts = {};
const changed = [];
for (const feed of feeds) {
    const {rows} = await c.query(`SELECT a.title, a.description FROM articles a JOIN feeds f ON f.id = a.id_feed
        WHERE f.url = $1 ORDER BY a.id DESC LIMIT 30`, [feed.url]);
    if (rows.length < 5) continue;
    const told = feedLanguage(rows.map(r => `${r.title ?? ''} ${r.description ?? ''}`), feed.url);
    const k = counts[feed.language] ??= {feeds: 0, same: 0};
    k.feeds++;
    if (told === feed.language) k.same++; else changed.push(`${feed.language} -> ${told}  ${feed.url.slice(0, 90)}`);
}
await c.end();
console.log(JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, v]) => v.feeds >= 5).sort((a, b) => b[1].feeds - a[1].feeds))));
for (const line of changed.sort()) console.log(line);
