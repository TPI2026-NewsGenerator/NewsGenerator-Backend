// the first thread test, step by step and timed, rolled back
import process from 'node:process';
import pg from 'pg';
import {toVector} from '../services/utils/embedder.js';
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const dense = (...values) => { const v = new Float32Array(1024); const n = Math.hypot(...values); values.forEach((x, i) => v[i] = x / n); return toVector(v); };
const step = async (name, sql, params) => { const t = performance.now(); const r = await c.query(sql, params); console.log(`${name}: ${Math.round(performance.now() - t)} ms`); return r.rows; };
let k = 0;
const story = async (feed, text, hours) => {
    const [{id}] = await step('insert story', `INSERT INTO stories (lang, updated_at, grouped_at) VALUES ('zz', timestamptz '2100-01-01' + make_interval(hours => $1), now()) RETURNING id`, [hours]);
    await step('insert article', `INSERT INTO articles (id_feed, link, title, published_at, lang, text_dense, embedded_at, id_story)
        VALUES ($1, $2, 'test', timestamptz '2100-01-01' + make_interval(hours => $3), 'zz', $4::halfvec, now(), $5)`, [feed, `https://m${++k}.invalid/${k}`, hours, text, id]);
    return id;
};
if (process.argv.includes('--plans')) {
    await c.query("LOAD 'auto_explain'");
    await c.query("SET auto_explain.log_min_duration = 50; SET auto_explain.log_nested_statements = on; SET auto_explain.log_analyze = on; SET client_min_messages = log");
    c.on('notice', (n) => console.log(n.message.split(/\r?\n/).filter(l => /duration|Scan|Query Text|loops/.test(l)).map(l => l.slice(0, 170)).join('\n')));
}
await c.query('BEGIN');
try {
    await step('isolation', "UPDATE stories SET threaded_at = now() WHERE grouped_at > COALESCE(threaded_at, '-infinity')");
    const [{id: feed}] = await step('feed', "INSERT INTO feeds (url) VALUES ('https://test.invalid/feed') RETURNING id");
    await story(feed, dense(1, 0, 0), 0);
    await step('assign', 'SELECT * FROM assign_threads(0.75, 0.10, 0.70, 7)');
    await story(feed, dense(1, 0.4, 0), 30);
    await story(feed, dense(0, 0, 1), 31);
    await step('assign', 'SELECT * FROM assign_threads(0.75, 0.10, 0.70, 7)');
} finally {
    await c.query('ROLLBACK');
    await c.end();
}
