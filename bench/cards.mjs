// the cards of the last briefing of a reader, with their vote, seen state and sources
// node bench/cards.mjs <userId> [briefingId]
import 'dotenv/config';
import pg from 'pg';
const [userId, id] = process.argv.slice(2).map(Number);
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
const {rows: feeds} = await client.query('SELECT url, origin, site, trusted FROM user_feeds WHERE id_user = $1', [userId]);
const {rows: [b]} = await client.query(`SELECT id, status, jsonb_array_length(items) AS n, round(extract(epoch FROM finished_at - created_at)) AS s, items
    FROM briefings WHERE id_user = $1 AND ($2::int IS NULL OR id = $2) ORDER BY id DESC LIMIT 1`, [userId, id || null]);
await client.end();
const origin = new Map(feeds.map(f => [f.url, `${f.origin}${f.trusted ? '*' : ''}:${f.site}`]));
console.log(`briefing ${b.id} ${b.status}, ${b.n} cards, ${b.s} s`);
b.items.forEach((it, i) => console.log(`${i} [${it.storyId}] ${it.vote ?? '-'} ${it.seenAt ? 'seen' : ''} | ${it.title.slice(0, 80)} | ${(it.interest ?? '').slice(0, 12)} | ${it.feedUrls.map(u => origin.get(u) ?? 'shared').join(', ')}${it.articles.some(a => a.trusted) ? ' | STAR' : ''}`));
