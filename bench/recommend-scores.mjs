// the candidates of the recommendations of each profile, with their scores: node bench/recommend-scores.mjs [userId...]
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import {rss} from '../db/rss-links.js';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const shared = Object.values(rss).flatMap(language => Object.values(language).flat());
const users = process.argv.slice(2).length ? process.argv.slice(2).map(Number)
    : (await c.query('SELECT id_user FROM user_profiles ORDER BY id_user')).rows.map(r => r.id_user);
const out = {};
for (const userId of users) {
    const {rows: [p]} = await c.query('SELECT languages FROM user_profiles WHERE id_user = $1', [userId]);
    const {rows} = await c.query(`
        WITH candidates AS (
            SELECT DISTINCT ON (uf.url) f.id, uf.url FROM user_feeds uf JOIN feeds f ON f.url = uf.url
            WHERE uf.id_user <> $1 AND (uf.origin = 'profile' OR uf.shared) AND uf.url <> ALL($2::text[])
              AND NOT EXISTS (SELECT 1 FROM user_feeds mine WHERE mine.id_user = $1 AND mine.url = uf.url)
            ORDER BY uf.url
        )
        SELECT c.id, c.url, a.title, (SELECT max(-(a.title_dense <#> i.dense)) FROM profile_interests i WHERE i.id_user = $1 AND i.dense IS NOT NULL) AS score
        FROM candidates c JOIN articles a ON a.id_feed = c.id
        WHERE a.embedded_at IS NOT NULL AND a.created_at >= now() - interval '7 days' AND a.lang = ANY($3::text[])`,
        [userId, shared, p.languages]);
    const feeds = new Map();
    for (const r of rows) {
        const f = feeds.get(r.url) ?? {url: r.url, news: 0, scores: [], titles: []};
        f.news++; f.scores.push(r.score); f.titles.push([r.score, r.title]);
        feeds.set(r.url, f);
    }
    out[userId] = [...feeds.values()].map(f => ({
        url: f.url, news: f.news,
        at45: f.scores.filter(s => s >= .45).length, at50: f.scores.filter(s => s >= .50).length, at55: f.scores.filter(s => s >= .55).length,
        top: f.titles.sort((a, b) => b[0] - a[0]).slice(0, 4).map(([s, t]) => `${s.toFixed(2)} ${t.slice(0, 80)}`),
    })).filter(f => f.at45 >= 1).sort((a, b) => b.at45 - a.at45);
}
fs.mkdirSync('bench/data/recommend', {recursive: true});
fs.writeFileSync('bench/data/recommend/scores.json', JSON.stringify(out, null, 1));
for (const [u, feeds] of Object.entries(out)) {
    console.log(`\n=== user ${u}: ${feeds.filter(f => f.at45 >= 3).length} recommended today`);
    for (const f of feeds.filter(f => f.at45 >= 2).slice(0, 14)) console.log(`  ${String(f.at45).padStart(3)}/${String(f.news).padEnd(4)} .50:${f.at50} .55:${f.at55}  ${f.url.slice(0, 60)}\n      ${f.top.slice(0, 2).join('\n      ')}`);
}
await c.end();
