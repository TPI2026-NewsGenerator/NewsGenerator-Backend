// removes a feed found by the directory, with its news: node --env-file=.env bench/remove-feed.mjs <url> <medium> "<reason>"
import pg from 'pg';
const [url, medium, reason] = process.argv.slice(2);
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
try {
    await c.query('BEGIN');
    const users = await c.query('SELECT count(*)::int AS n FROM user_feeds WHERE url = $1', [url]);
    if (users.rows[0].n > 0) throw new Error('a reader has this feed: not removed');
    const dir = await c.query('DELETE FROM directory_feeds WHERE url = $1', [url]);
    const tries = await c.query('UPDATE directory_tries SET kept = 0, reason = $2 WHERE medium = $1', [medium, reason]);
    const news = await c.query('SELECT count(*)::int AS n FROM articles a JOIN feeds f ON f.id = a.id_feed WHERE f.url = $1', [url]);
    const feeds = await c.query('DELETE FROM feeds WHERE url = $1', [url]);   // its articles go with it (fk_id_feed cascade)
    await c.query('COMMIT');
    console.log({directory: dir.rowCount, tries: tries.rowCount, feeds: feeds.rowCount, news: news.rows[0].n});
} catch (err) {
    await c.query('ROLLBACK');
    console.error(err.message);
    process.exitCode = 1;
} finally {
    await c.end();
}
