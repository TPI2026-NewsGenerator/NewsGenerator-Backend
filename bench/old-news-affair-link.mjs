// Is an old news the continuation of an affair the reader already saw? (the user, 10.11.2026: "si une vieille news ressort c'est sûrement la continuité d'une nouvelle")
// For the 66 stories rated by hand: whether another card of the SAME AFFAIR (thread) was in the same briefing, or in a briefing of the same profile of the 4 days
// before, for the stale ones (S) and the fresh ones (F). node --env-file=.env bench/old-news-affair-link.mjs
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

const sets = [
    {pack: 'bench/data/old-news-pack.json', labels: 'bench/data/old-news-labels.json'},
    {pack: 'bench/data/old-news-pack2.json', labels: 'bench/data/old-news-labels2.json'},
];
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const out = [];
for (const {pack, labels} of sets) {
    const rated = JSON.parse(fs.readFileSync(labels, 'utf8')).labels;
    for (const item of JSON.parse(fs.readFileSync(pack, 'utf8'))) {
        const label = rated[item.n];
        if (label !== 'S' && label !== 'F') continue;
        const {rows: [mine]} = await c.query('SELECT s.id_thread FROM stories s WHERE s.id = $1', [item.storyId]);
        const {rows: [briefing]} = await c.query('SELECT id, id_profile, created_at FROM briefings WHERE id = $1', [item.briefing]);
        if (!mine?.id_thread || !briefing) { out.push({label, sameBriefing: false, before: false, noThread: true}); continue; }
        // the cards of the same profile in this briefing and the 4 days before, of the same thread, not this story itself
        const {rows} = await c.query(`
            SELECT b.id, (card->>'storyId')::int AS story, b.created_at
            FROM briefings b, jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) AS card
            WHERE b.id_profile = $1 AND b.status = 'ready' AND b.created_at <= $2 AND b.created_at > $2::timestamptz - interval '4 days'
              AND (card->>'storyId')::int > 0`, [briefing.id_profile, briefing.created_at]);
        const ids = [...new Set(rows.map(row => row.story))];
        const {rows: threads} = ids.length === 0 ? {rows: []} : await c.query('SELECT id, id_thread FROM stories WHERE id = ANY($1)', [ids]);
        const sameThread = new Set(threads.filter(row => row.id_thread === mine.id_thread && row.id !== item.storyId).map(row => row.id));
        const hits = rows.filter(row => sameThread.has(row.story));
        out.push({label, noThread: false, sameBriefing: hits.some(row => row.id === briefing.id), before: hits.some(row => row.id !== briefing.id)});
    }
}
await c.end();
for (const label of ['S', 'F']) {
    const xs = out.filter(row => row.label === label);
    const pct = (n) => `${n}/${xs.length} (${Math.round(100 * n / xs.length)}%)`;
    console.log(`${label}: ${xs.length} stories; in a thread ${pct(xs.filter(row => !row.noThread).length)}; another card of the affair in the SAME briefing ${pct(xs.filter(row => row.sameBriefing).length)}; in a briefing of the 4 days BEFORE ${pct(xs.filter(row => row.before).length)}; either ${pct(xs.filter(row => row.sameBriefing || row.before).length)}`);
}
