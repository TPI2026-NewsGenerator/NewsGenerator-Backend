// The pages of articles read by Crawlee (Crawlers.Html) and by a plain fetch (Crawlers.Pages): the
// same recent links of many media, one per medium, how many each reads in full (60 words or more, see
// canSummarize) and how long it takes. Read only.
//   node --env-file=.env bench/page-reader.mjs [media=80]
import pg from 'pg';
import {Crawlers} from '../services/utils/crawlers.js';
import {canSummarize} from '../services/utils/extract.js';

const count = Number(process.argv[2] ?? 80);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
// the last news of the media the briefings read most: one link per medium, no page of Google News
const {rows} = await db.query(`
    SELECT DISTINCT ON (medium) medium, link FROM (
        SELECT regexp_replace(split_part(split_part(a.link, '://', 2), '/', 1), '^www\\.', '') AS medium, a.link, a.created_at
        FROM articles a
        WHERE a.created_at > now() - interval '12 hours' AND a.link NOT LIKE '%news.google.%' AND a.id_story IS NOT NULL
    ) recent ORDER BY medium, created_at DESC`);
await db.end();
const links = rows.sort(() => Math.random() - 0.5).slice(0, count).map(r => r.link);

const measure = async (name, read) => {
    const started = Date.now();
    const pages = await read(links);
    const full = new Set(pages.filter(page => canSummarize(page.content)).map(page => page.url));
    return {name, seconds: (Date.now() - started) / 1000, read: pages.length, full};
};
const fetched = await measure('fetch', Crawlers.Pages);
const crawled = await measure('crawlee', Crawlers.Html);
for (const r of [fetched, crawled]) console.log(`${r.name}: ${r.read} pages read, ${r.full.size} of ${links.length} in full, ${r.seconds} s`);
const onlyFetch = links.filter(l => fetched.full.has(l) && !crawled.full.has(l));
const onlyCrawlee = links.filter(l => crawled.full.has(l) && !fetched.full.has(l));
console.log(`only fetch (${onlyFetch.length}):`, onlyFetch.map(l => new URL(l).hostname).join(', '));
console.log(`only crawlee (${onlyCrawlee.length}):`, onlyCrawlee.map(l => new URL(l).hostname).join(', '));
process.exit(0);
