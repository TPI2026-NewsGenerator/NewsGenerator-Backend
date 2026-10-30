import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const [{id}] = (await c.query(`SELECT id FROM users WHERE username = 'lecteur-foot'`)).rows;
const t0 = Date.now();
for (;;) {
    const [row] = (await c.query(`SELECT discovery_status, discovery_error FROM user_profiles WHERE id_user = $1`, [id])).rows;
    if (row?.discovery_status !== 'running' || Date.now() - t0 > 45 * 60e3) {
        console.log('user', id, row, Math.round((Date.now() - t0) / 1000), 's');
        console.log((await c.query(`SELECT url, category, language FROM user_feeds WHERE id_user = $1 AND origin = 'profile' ORDER BY id`, [id])).rows);
        break;
    }
    await new Promise(r => setTimeout(r, 15000));
}
await c.end();
