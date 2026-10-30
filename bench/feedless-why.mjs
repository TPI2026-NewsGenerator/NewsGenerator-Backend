// dry: why the addresses of an imported list end with no feed. Reads the web only, saves nothing.
// node --env-file=.env bench/feedless-why.mjs <addresses.json> <out.json>
import {readFileSync, writeFileSync} from 'node:fs';
import {findFeeds} from '../services/utils/feed-finder.js';
import {articlePatterns} from '../services/utils/feed-bridge.js';
import {Crawlers} from '../services/utils/crawlers.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';
import {guardFetch} from '../services/utils/public-url.js';

guardFetch();
process.on('uncaughtException', err => console.log(`uncaught: ${err.message}`));
process.on('unhandledRejection', err => console.log(`unhandled: ${err?.message ?? err}`));

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const addresses = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

// what the home page looks like to a plain request
const homeOf = async (url) => {
    try {
        const res = await fetch(url, {headers: {'User-Agent': BROWSER, Accept: 'text/html'}, redirect: 'follow', signal: AbortSignal.timeout(15000)});
        const html = await res.text();
        const host = new URL(res.url).host.replace(/^www\./, '');
        const links = [...html.matchAll(/<a\s[^>]*href="([^"#]+)"/gi)].map(m => { try { return new URL(m[1], res.url); } catch { return null; } }).filter(Boolean);
        const own = links.filter(link => link.host.replace(/^www\./, '').endsWith(host));
        const deep = own.filter(link => link.pathname.split('/').filter(Boolean).length >= 2 || /\d{4,}|-.*-.*-/.test(link.pathname));
        return {
            status: res.status, finalUrl: res.url, bytes: html.length, links: links.length, deep: new Set(deep.map(l => l.pathname)).size,
            challenge: /just a moment|cf-chl|challenge-platform|captcha|access denied|enable javascript/i.test(html.slice(0, 20000)),
            articles: (html.match(/<article\b/gi) ?? []).length,
            times: (html.match(/<time\b/gi) ?? []).length,
            patterns: articlePatterns(html).slice(0, 3),
        };
    } catch (err) {
        return {error: err.cause?.code ?? err.message};
    }
};

// the ones read by an earlier run that stopped are not read again
let earlier = [];
try { earlier = JSON.parse(readFileSync(process.argv[3], 'utf8')); } catch { /* first run */ }
const known = new Map(earlier.filter(row => row.address).map(row => [row.address, row]));
const partial = [];
let done = 0;
const results = await mapWithConcurrency(addresses, 6, async (address) => {
    if (known.has(address)) return known.get(address);
    const row = await one(address);
    partial.push(row);
    if (partial.length % 25 === 0) writeFileSync(process.argv[3], JSON.stringify([...known.values(), ...partial]));
    return row;
});
async function one(address) {
    let feeds = [];
    let error = null;
    try {
        feeds = await timeout(findFeeds(address, {language: 'en'}), 60000);
    } catch (err) {
        error = err.message;
    }
    if (++done % 50 === 0) console.log(`${done} / ${addresses.length}`);
    if (feeds.length > 0) return {address, found: feeds[0].url.includes('CssSelectorBridge') ? 'bridge' : 'feed'};
    return {address, found: null, error, home: await homeOf(address)};
}
const rows = results.map(result => result.value ?? {error: String(result.reason)});
writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
const none = rows.filter(row => !row.found);
console.log({total: rows.length, feed: rows.filter(r => r.found === 'feed').length, bridge: rows.filter(r => r.found === 'bridge').length, none: none.length});

// the first bridge tried for the ones whose page has patterns: why it was refused
const withPatterns = none.filter(row => row.home?.patterns?.length > 0).slice(0, 25);
for (const row of withPatterns) {
    const bridge = (process.env.RSS_BRIDGE_URL ?? '').replace(/\/$/, '');
    const url = `${bridge}/?` + new URLSearchParams({action: 'display', bridge: 'CssSelectorBridge', format: 'Atom', limit: '15',
        home_page: row.home.finalUrl, url_selector: `a[href*="${row.home.patterns[0]}"]`, content_selector: 'article'});
    const [feed] = await Crawlers.Xml([{url}]);
    row.bridgeTry = feed.error ? {error: String(feed.error).slice(0, 120)}
        : {items: feed.items.length, titled: feed.items.filter(i => (i.title ?? '').trim().length >= 15).length, dated: feed.items.filter(i => i.pubDate).length};
}
writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
process.exit(0);
