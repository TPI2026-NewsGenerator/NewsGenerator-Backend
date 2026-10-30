// Checks a list of sites a reader proposed (bench/data/uefa/list.tsv: country, name, url): the feed
// each one publishes, its language, how many news of the last 7 days, and whether the server already
// reads that medium. node --env-file=.env bench/uefa-sources.mjs > bench/data/uefa/check.json
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {findFeeds} from '../services/utils/feed-finder.js';
import {LANGUAGES} from '../services/utils/language.js';
import {mapWithConcurrency} from '../services/utils/concurrency.js';

const rows = readFileSync('bench/data/uefa/list.tsv', 'utf8').trim().split('\n').map(line => {
    const [country, name, url] = line.split('\t');
    return {country, name, url: url.trim()};
});
const key = (url) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/[/#?]+$/, '').toLowerCase();
const unique = [...new Map(rows.map(row => [key(row.url), row])).values()];
const hostOf = (url) => new URL(url).host.replace(/^www\./, '');

const c = new pg.Client({connectionString: process.env.DATABASE_URL});
await c.connect();
const read = new Map((await c.query(`
    SELECT a.medium, count(*)::int AS news FROM articles a
    WHERE a.created_at > now() - interval '7 days' AND a.medium IS NOT NULL GROUP BY a.medium`)).rows.map(r => [r.medium, r.news]));
await c.end();

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
let done = 0;
const results = (await mapWithConcurrency(unique, 6, async (row) => {
    const host = hostOf(row.url);
    // the medium of a news is its site without the subdomain: sport.news.am is news.am
    const known = read.get(host) ?? read.get(host.split('.').slice(1).join('.')) ?? 0;
    let feeds = [];
    let error = null;
    try {
        feeds = await withTimeout(findFeeds(row.url, {bridge: false}), 60000);
    } catch (err) {
        error = err.message;
    }
    const live = feeds.filter(feed => feed.recent >= 3);
    const ours = live.find(feed => LANGUAGES.includes(feed.language));
    const best = ours ?? live[0] ?? feeds[0] ?? null;
    if (++done % 25 === 0) console.error(`${done}/${unique.length}`);
    return {
        ...row, host, readNews7d: known, error,
        feeds: feeds.length,
        best: best && {url: best.url, recent: best.recent, items: best.items, language: best.language},
        verdict: ours ? 'feed' : live.length ? 'feed-other-language' : feeds.length ? 'feed-asleep' : 'no-feed',
    };
})).map(result => result.value ?? {error: String(result.reason)});

console.log(JSON.stringify({checkedAt: new Date().toISOString(), sites: unique.length, results}, null, 1));
