import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
// news created in the window, joined within 3 h by a news of another medium (or joining one already there)
const q = async (from, to) => (await c.query(`
  SELECT count(*)::int AS news,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM articles m WHERE m.id_story = a.id_story AND m.medium <> a.medium
                                        AND m.created_at <= a.created_at + interval '3 hours'))::int AS shared
  FROM articles a WHERE a.created_at >= $1 AND a.created_at < $2 AND a.embedded_at IS NOT NULL`, [from, to])).rows[0];
for (const [label, from, to] of [
  ['2.10 00:57-07:00 (PyTorch)', '2026-10-02T00:57:30Z', '2026-10-02T07:00Z'],
  ['3.10 00:57-07:00 (ONNX)   ', '2026-10-03T00:57:30Z', '2026-10-03T07:00Z']]) {
  const r = await q(from, to);
  console.log(`${label}  ${r.news} news, ${r.shared} (${(100 * r.shared / r.news).toFixed(1)}%) with another medium within 3 h`);
}
await c.end();
