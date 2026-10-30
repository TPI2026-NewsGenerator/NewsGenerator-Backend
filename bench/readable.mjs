// how many pages Readability reads in full, on random articles and on stories as the briefing reads them
// node bench/readable.mjs [articles] [stories] [days]
import 'dotenv/config';
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize, sentencesOf} from '../services/utils/extract.js';
const [nArticles = 200, nStories = 60, days = 3] = process.argv.slice(2).map(Number);
const c = new pg.Client({connectionString: process.env.DATABASE_URL}); await c.connect();
const addr = `COALESCE(resolved_link, link)`;
const notGoogle = `(link NOT LIKE 'https://news.google.com/%' OR resolved_link IS NOT NULL)`;
const {rows: articles} = await c.query(`SELECT ${addr} AS url, medium FROM articles
    WHERE created_at > now() - make_interval(days => $1::int) AND ${notGoogle} ORDER BY random() LIMIT $2`, [days, nArticles]);
const {rows: storyRows} = await c.query(`WITH s AS (SELECT id_story FROM articles WHERE id_story IS NOT NULL
      AND created_at > now() - make_interval(days => $1::int) GROUP BY id_story HAVING count(DISTINCT medium) >= 2 ORDER BY random() LIMIT $2)
    SELECT DISTINCT ON (a.id_story, a.medium) a.id_story, ${addr} AS url, a.medium FROM articles a JOIN s USING (id_story)
    WHERE ${notGoogle} ORDER BY a.id_story, a.medium, a.created_at`, [days, nStories]);
const googleOnly = (await c.query(`SELECT count(*)::int n, count(resolved_link)::int r FROM articles
    WHERE created_at > now() - make_interval(days => $1::int) AND link LIKE 'https://news.google.com/%'`, [days])).rows[0];
await c.end();
const stories = new Map();
for (const r of storyRows) { const l = stories.get(r.id_story) ?? []; if (l.length < 5) l.push(r); stories.set(r.id_story, l); }

const urls = [...new Set([...articles, ...storyRows].map(r => r.url))];
const t = Date.now();
const pages = new Map((await Crawlers.Html(urls)).map(p => [p.url, p]));
const words = (s) => (s ?? '').split(/\s+/).filter(Boolean).length;
const kind = (url) => {
    const p = pages.get(url);
    if (!p || !p.content) return 'unread';
    if (!canSummarize(p.content)) return 'short';
    return 'full';
};
const tally = {unread: 0, short: 0, full: 0}; const byMedium = new Map(); let flat = 0; const w = [];
for (const a of articles) {
    const k = kind(a.url); tally[k]++;
    const m = byMedium.get(a.medium) ?? {unread: 0, short: 0, full: 0}; m[k]++; byMedium.set(a.medium, m);
    if (k === 'full') {
        const p = pages.get(a.url); w.push(words(p.content));
        const inBlocks = p.blocks.filter(b => b.kind === 'text' || b.kind === 'quote');
        if (words(inBlocks.map(b => b.text).join(' ')) < words(p.content) / 2) flat++;
    }
}
const pct = (n, d) => `${Math.round(100 * n / d)}%`;
console.log(`crawl of ${urls.length} pages: ${Math.round((Date.now() - t) / 1000)} s`);
console.log(`ARTICLES (${articles.length}): full ${tally.full} (${pct(tally.full, articles.length)}), short ${tally.short} (${pct(tally.short, articles.length)}), unread ${tally.unread} (${pct(tally.unread, articles.length)})`);
w.sort((a, b) => a - b);
console.log(`  full pages: median ${w[w.length >> 1]} words; cut from flat text (no usable blocks) ${flat}`);
let any = 0, first = 0, fullCount = 0, readCount = 0;
for (const list of stories.values()) {
    const ks = list.map(r => kind(r.url));
    if (ks.includes('full')) any++;
    if (ks[0] === 'full') first++;
    fullCount += ks.filter(k => k === 'full').length; readCount += ks.length;
}
console.log(`STORIES (${stories.size}, ≤5 media each, ${readCount} pages): ≥1 page full ${any} (${pct(any, stories.size)}); pages full ${pct(fullCount, readCount)}`);
console.log(`Google News links of the period: ${googleOnly.n}, decoded ${googleOnly.r} (the others are never read)`);
console.log('by medium (full/short/unread), ≥3 articles:');
for (const [m, v] of [...byMedium].filter(([, v]) => v.full + v.short + v.unread >= 3).sort((a, b) => (b[1].full + b[1].short + b[1].unread) - (a[1].full + a[1].short + a[1].unread))) {
    console.log(`  ${m}: ${v.full}/${v.short}/${v.unread}`);
}
process.exit(0);
