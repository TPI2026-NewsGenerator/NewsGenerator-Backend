// How many briefing cards have a history: their story's thread holds stories of earlier days
// node --env-file=.env bench/thread-history.mjs [briefings]
import pg from 'pg';
const [n = 30] = process.argv.slice(2).map(Number);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const {rows} = await c.query(`
  WITH b AS (SELECT id, created_at, items FROM briefings WHERE status = 'ready' AND jsonb_typeof(items) = 'array'
             AND jsonb_array_length(items) > 0 ORDER BY created_at DESC LIMIT $1),
  cards AS (SELECT b.id AS briefing, b.created_at AS at, (card->>'storyId')::int AS story,
                   jsonb_array_length(COALESCE(card->'angles', '[]'::jsonb)) AS angles, card->>'title' AS title
            FROM b, jsonb_array_elements(b.items) card WHERE (card->>'storyId')::int > 0)
  SELECT cards.*, s.id_thread,
    (SELECT count(*) FROM stories o WHERE o.id_thread = s.id_thread AND o.id <> s.id AND o.created_at < cards.at - interval '24 hours')::int AS older,
    (SELECT count(DISTINCT date(o.created_at)) FROM stories o WHERE o.id_thread = s.id_thread AND o.created_at < cards.at)::int AS days,
    (SELECT min(o.created_at) FROM stories o WHERE o.id_thread = s.id_thread) AS first
  FROM cards LEFT JOIN stories s ON s.id = cards.story`, [n]);
await c.end();
const total = rows.length, pct = (k) => `${k}/${total} (${Math.round(100 * k / total)}%)`;
console.log(`${new Set(rows.map(r => r.briefing)).size} briefings, ${total} cards`);
console.log(`in a thread: ${pct(rows.filter(r => r.id_thread).length)}`);
console.log(`thread with a story >24h before the briefing: ${pct(rows.filter(r => r.older > 0).length)}`);
console.log(`thread over >=3 days: ${pct(rows.filter(r => r.days >= 3).length)}`);
console.log(`with other angles (same affair): ${pct(rows.filter(r => r.angles > 0).length)}`);
console.log(`history (older story or angles): ${pct(rows.filter(r => r.older > 0 || r.angles > 0).length)}`);
const per = new Map(); for (const r of rows) { const p = per.get(r.briefing) ?? [0, 0]; p[0]++; if (r.older > 0) p[1]++; per.set(r.briefing, p); }
console.log('per briefing (cards with older thread stories / cards):', [...per.values()].map(([a, b]) => `${b}/${a}`).join(' '));
console.log('samples with history:'); rows.filter(r => r.days >= 3).slice(0, 12).forEach(r => console.log(`  ${r.days} days, ${r.older} older stories since ${r.first?.toISOString().slice(0, 10)} | ${r.title?.slice(0, 90)}`));
