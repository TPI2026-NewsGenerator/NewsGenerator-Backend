// The media found without a feed (directory_tries): how many publish a news sitemap (the list of their
// recent articles they give to Google News, with titles and dates), declared in robots.txt or at a
// usual address. Read only.
//   node --env-file=.env bench/news-sitemaps.mjs [media=40]
import pg from 'pg';
import {XMLParser} from 'fast-xml-parser';

const count = Number(process.argv[2] ?? 40);
const db = new pg.Client({connectionString: process.env.DATABASE_URL});
await db.connect();
const {rows: reasons} = await db.query(`SELECT reason, count(*)::int AS n FROM directory_tries WHERE kept = 0 GROUP BY reason ORDER BY n DESC LIMIT 8`);
console.log('reasons:', reasons.map(r => `${r.reason}: ${r.n}`).join(' | '));
const {rows} = await db.query(`SELECT medium FROM directory_tries WHERE kept = 0 AND reason ILIKE '%no feed%' ORDER BY random() LIMIT $1`, [count]);
await db.end();

const UA = 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)';
const PATHS = ['/news-sitemap.xml', '/sitemap_news.xml', '/sitemap-news.xml', '/news_sitemap.xml', '/sitemaps/news.xml', '/sitemap/news.xml'];
const parser = new XMLParser({ignoreAttributes: false, isArray: (name) => ['url', 'sitemap'].includes(name)});
const get = async (url) => {
    try {
        const res = await fetch(url, {headers: {'User-Agent': UA}, signal: AbortSignal.timeout(10000)});
        return res.ok ? await res.text() : null;
    } catch {
        return null;
    }
};
// a news sitemap: <urlset> whose <url> carry <news:news> with a title
const newsItems = (xml) => {
    try {
        const data = parser.parse(xml);
        return (data.urlset?.url ?? []).filter(url => url['news:news']?.['news:title']).length;
    } catch {
        return 0;
    }
};
const childSitemaps = (xml) => {
    try {
        return (parser.parse(xml).sitemapindex?.sitemap ?? []).map(s => String(s.loc ?? '')).filter(loc => /news/i.test(loc)).slice(0, 2);
    } catch {
        return [];
    }
};

let found = 0;
for (const {medium} of rows) {
    const home = `https://${medium}`;
    const robots = await get(`${home}/robots.txt`) ?? '';
    const declared = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]);
    const candidates = [...new Set([...declared.filter(url => /news/i.test(url)), ...PATHS.map(path => home + path)])];
    let hit = null;
    for (const url of candidates) {
        const xml = await get(url);
        if (!xml) continue;
        let items = newsItems(xml);
        if (items === 0) {
            for (const child of childSitemaps(xml)) {
                const sub = await get(child);
                if (sub && (items = newsItems(sub)) > 0) { hit = `${child} (${items})`; break; }
            }
        } else hit = `${url} (${items})`;
        if (hit) break;
    }
    if (hit) found++;
    console.log(`${hit ? 'NEWS ' : '     '} ${medium}${hit ? `  ${hit}` : ''}`);
}
console.log(`${found} of ${rows.length} media without a feed publish a news sitemap`);
process.exit(0);
