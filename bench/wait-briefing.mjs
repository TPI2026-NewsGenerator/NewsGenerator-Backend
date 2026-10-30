import pg from 'pg';
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const t0 = Date.now();
for (;;) {
    const [b] = (await c.query(`SELECT id, status, step, error, items, created_at, finished_at FROM briefings WHERE id_user = 384 ORDER BY id DESC LIMIT 1`)).rows;
    if (b && b.status !== 'running' || Date.now() - t0 > 30 * 60e3) {
        console.log(b.id, b.status, b.error, Math.round((new Date(b.finished_at) - new Date(b.created_at)) / 1000), 's');
        for (const item of b.items ?? []) console.log('-', item.title, '|', item.source, '|', (item.corroboration?.mediaNames ?? []).join(', '), '| passages:', item.summary ? 'yes' : (item.summaryError ?? 'no'));
        break;
    }
    await new Promise(r => setTimeout(r, 10000));
}
await c.end();
