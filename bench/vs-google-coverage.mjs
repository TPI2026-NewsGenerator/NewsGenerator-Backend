// for each Google News result of bench/vs-google.mjs: is the article in our DB (from a feed, or only a
// Google News row), matched on the title written without case, accents or punctuation (or its first 50 characters)
// node --env-file=.env bench/vs-google-coverage.mjs bench/data/vs-google/<date>.json
import fs from 'node:fs';
import pg from 'pg';
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rows = (await c.query(`SELECT a.title, f.url LIKE 'https://news.google.com/%' AS google FROM articles a JOIN feeds f ON f.id = a.id_feed
    WHERE a.created_at > now() - interval '12 days'`)).rows;
const full = new Map(), start = new Map();
for (const {title, google} of rows) {
    for (const [map, key] of [[full, norm(title)], [start, norm(title).slice(0, 50)]]) {
        if (key.length < 20) continue;
        if (!google || !map.has(key)) map.set(key, google ? 'google-row' : 'feed');
    }
}
const totals = {feed: 0, 'google-row': 0, no: 0, knownMissing: 0, all: 0};
for (const q of data.queries) {
    for (const item of q.google) {
        const key = norm(item.title);
        item.inDb = full.get(key) ?? (key.length >= 50 ? start.get(key.slice(0, 50)) : null) ?? 'no';
    }
    const n = (k) => q.google.filter(i => i.inDb === k).length;
    const km = q.google.filter(i => i.inDb === 'no' && i.known).length;
    for (const k of ['feed', 'google-row', 'no']) totals[k] += n(k);
    totals.knownMissing += km; totals.all += q.google.length;
    console.log(`${q.text.slice(0, 50).padEnd(50)} ${String(q.google.length).padStart(2)}: from our feeds ${n('feed')}, only a Google row ${n('google-row')}, not in the DB ${n('no')} (medium we read: ${km})`);
}
console.log('total', totals, `titles compared ${rows.length}`);
fs.writeFileSync(file, JSON.stringify(data, null, 1));
await c.end();
