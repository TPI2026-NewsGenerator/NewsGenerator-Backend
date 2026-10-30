// waits until the discovery of a profile is done and its feeds' news have vectors: node bench/wait-profile.mjs <userId> [seconds]
import 'dotenv/config';
import pg from 'pg';
const [userId, seconds = 300] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const t0 = Date.now();
let row;
while (Date.now() - t0 < seconds * 1000) {
    ({rows: [row]} = await c.query(`SELECT up.discovery_status AS status, up.discovery_error AS error,
        (SELECT count(*) FROM user_feeds uf WHERE uf.id_user = up.id_user)::int AS feeds,
        (SELECT count(*) FROM articles a JOIN feeds f ON f.id = a.id_feed JOIN user_feeds uf ON uf.url = f.url AND uf.id_user = up.id_user)::int AS news,
        (SELECT count(*) FROM articles a JOIN feeds f ON f.id = a.id_feed JOIN user_feeds uf ON uf.url = f.url AND uf.id_user = up.id_user WHERE a.embedded_at IS NOT NULL)::int AS embedded
        FROM user_profiles up WHERE up.id_user = $1`, [userId]));
    if (row.status !== 'running' && row.news > 0 && row.embedded >= row.news * 0.9) break;
    await new Promise(r => setTimeout(r, 15000));
}
console.log(Math.round((Date.now() - t0) / 1000), 's', row);
await c.end();
